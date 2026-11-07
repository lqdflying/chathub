import type Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatMethodOptions, ChatStreamPayload, OpenAIChatMessage } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { LobeAnthropicAI, normalizeAnthropicBaseURL } from '../anthropic';

/**
 * DeepSeek V4 thinking mode defaults to **enabled**.
 * To disable reasoning, the API requires `thinking: { type: 'disabled' }`
 * in the request body.  When thinking is enabled, `temperature`, `top_p`,
 * `presence_penalty`, and `frequency_penalty` are silently ignored by the
 * API, so we strip them from the payload to keep the request clean.
 *
 * Do NOT send `reasoning_effort` when thinking is disabled.
 *
 * @see https://api-docs.deepseek.com/guides/thinking_mode
 */
const isThinkingEnabled = (payload: ChatStreamPayload) => {
  return payload.thinking?.type === 'enabled';
};

/**
 * DeepSeek's API does not support `thinking` content blocks in message content
 * arrays (only `text` type).  Strip them from all assistant messages so the
 * API does not reject the request with:
 *   unknown variant `thinking`, expected `text`
 *
 * DeepSeek uses `reasoning_content` in the response stream and the top-level
 * `thinking` request-body parameter — not content-block annotations.
 */
const stripThinkingContentBlocks = (messages: OpenAIChatMessage[]): OpenAIChatMessage[] => {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const filtered = msg.content.filter((part: any) => part.type !== 'thinking');

    // If nothing remains after stripping thinking blocks, fall back to empty string
    if (filtered.length === 0) return { ...msg, content: '' };
    // If only a single text block remains, flatten back to a plain string
    if (filtered.length === 1 && filtered[0].type === 'text') {
      return { ...msg, content: (filtered[0] as any).text || '' };
    }
    return { ...msg, content: filtered };
  });
};

/** Exported for unit tests — DeepSeek request shaping. */
export const buildDeepSeekPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const requestPayload = { ...payload };
  delete requestPayload.enabledSearch;

  const {
    frequency_penalty,
    messages,
    model,
    presence_penalty,
    reasoning_effort: reasoningEffort,
    temperature,
    thinking,
    tools,
    top_p,
    ...rest
  } = requestPayload;

  const thinkingEnabled = isThinkingEnabled(payload);

  // Build tools: DeepSeek supports standard OpenAI tools
  const deepseekTools = tools?.length ? tools : undefined;

  // When thinking is enabled, strip params that the API ignores
  const shouldStripSamplingParams = thinkingEnabled;

  // Strip thinking content blocks from messages — DeepSeek only supports "text" type
  const sanitizedMessages = stripThinkingContentBlocks(messages);

  return {
    ...rest,
    messages: sanitizedMessages as OpenAI.ChatCompletionMessageParam[],
    model,
    stream: payload.stream ?? true,
    // Only include sampling params when thinking is NOT enabled
    ...(shouldStripSamplingParams
      ? {}
      : {
          frequency_penalty,
          presence_penalty,
          temperature,
          top_p,
        }),
    // Forward reasoning_effort only when thinking is enabled
    ...(thinkingEnabled && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    // V4 defaults to thinking enabled; explicitly send disabled when off
    ...(thinking ? { thinking: { type: thinking.type } } : {}),
    tools: deepseekTools,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchDeepSeekModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ context_length?: number; id: string }> = modelsPage.data || [];

    return processModelList(
      modelList.map((model) => ({
        contextWindowTokens: model.context_length,
        id: model.id,
      })),
      MODEL_LIST_CONFIGS.deepseek,
      ModelProvider.DeepSeek,
    );
  } catch (error) {
    console.warn('Failed to fetch DeepSeek models:', error);
    return [];
  }
};

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** DeepSeek serves the Anthropic Messages API under `/anthropic` on the same host. */
export const toDeepSeekAnthropicBaseURL = (baseURL: string = DEEPSEEK_BASE_URL): string =>
  `${normalizeAnthropicBaseURL(baseURL)}/anthropic`;

/**
 * The shared Anthropic builder targets Claude; DeepSeek's Anthropic endpoint takes
 * effort via `output_config`, a 0–2 temperature, and an optional `max_tokens`.
 *
 * @see https://api-docs.deepseek.com/guides/anthropic_api
 */
const shapeDeepSeekAnthropicParams = (
  params: Anthropic.MessageCreateParams,
  payload: ChatStreamPayload,
): Anthropic.MessageCreateParams => {
  const shaped: Record<string, unknown> = { ...params };

  if (isThinkingEnabled(payload)) {
    if (payload.reasoning_effort) shaped.output_config = { effort: payload.reasoning_effort };
  } else if (payload.temperature !== undefined) {
    shaped.temperature = payload.temperature;
  }

  if (payload.max_tokens === undefined) delete shaped.max_tokens;

  return shaped as unknown as Anthropic.MessageCreateParams;
};

class DeepSeekAnthropicSearchAI extends LobeAnthropicAI {
  protected override async buildAnthropicPayload(payload: ChatStreamPayload) {
    return shapeDeepSeekAnthropicParams(await super.buildAnthropicPayload(payload), payload);
  }
}

const LobeDeepSeekPlatform = createOpenAICompatibleRuntime({
  baseURL: DEEPSEEK_BASE_URL,
  cacheSupport: 'supported',
  chatCompletion: {
    handlePayload: buildDeepSeekPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  models: fetchDeepSeekModels,
  provider: ModelProvider.DeepSeek,
});

/**
 * Chat Completions rejects DeepSeek's built-in `web_search` tool, and the Responses
 * API ignores it on `deepseek-flash`. The Anthropic endpoint runs it server-side for
 * both models, so only search turns use it.
 */
export class LobeDeepSeekAI extends LobeDeepSeekPlatform {
  private anthropicSearchRuntime?: DeepSeekAnthropicSearchAI;

  private getAnthropicSearchRuntime() {
    this.anthropicSearchRuntime ??= new DeepSeekAnthropicSearchAI({
      apiKey: this._options.apiKey,
      baseURL: toDeepSeekAnthropicBaseURL(this.baseURL),
      id: ModelProvider.DeepSeek,
    });
    return this.anthropicSearchRuntime;
  }

  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    if (!payload.enabledSearch) return super.chat(payload, options);

    return this.getAnthropicSearchRuntime().chat(payload, options);
  }
}
