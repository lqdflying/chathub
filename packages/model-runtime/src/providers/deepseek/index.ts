import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';

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

/** Exported for unit tests — DeepSeek request shaping. */
export const buildDeepSeekPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const {
    enabledSearch,
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
  } = payload;

  const thinkingEnabled = isThinkingEnabled(payload);

  // Build tools: DeepSeek supports standard OpenAI tools
  const deepseekTools = tools?.length ? tools : undefined;

  // When thinking is enabled, strip params that the API ignores
  const shouldStripSamplingParams = thinkingEnabled;

  return {
    ...rest,
    messages: messages as OpenAI.ChatCompletionMessageParam[],
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

    return modelList.map((model) => ({
      contextWindowTokens: model.context_length,
      id: model.id,
    }));
  } catch (error) {
    console.warn('Failed to fetch DeepSeek models:', error);
    return [];
  }
};

export const LobeDeepSeekAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.deepseek.com',
  chatCompletion: {
    handlePayload: buildDeepSeekPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  models: fetchDeepSeekModels,
  provider: ModelProvider.DeepSeek,
});
