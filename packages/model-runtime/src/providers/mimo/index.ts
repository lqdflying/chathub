import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload, OpenAIChatMessage } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

/**
 * Official Chat Completions: https://mimo.mi.com/docs/en-US/api/chat/openai-api
 *
 * Thinking defaults to enabled on the vendor. ChatHub sends `thinking.type`
 * explicitly when the gear toggle is present. When thinking is on, temperature
 * and top_p are ignored upstream, so they are stripped. Official max-token
 * field is `max_completion_tokens`. `tool_choice` only accepts `auto`.
 *
 * Native web search is `{ type: 'web_search' }` in `tools` (no force_search
 * by default). Multi-turn tool calls in thinking mode should keep
 * `reasoning_content` on assistant messages.
 */
const MIMO_WEB_SEARCH_TOOL = { type: 'web_search' } as const;
const MIMO_NON_CHAT_ID = /tts|asr|voiceclone|voicedesign/i;

const isThinkingEnabled = (payload: ChatStreamPayload) => payload.thinking?.type === 'enabled';

const stripThinkingContentBlocks = (messages: OpenAIChatMessage[]): OpenAIChatMessage[] => {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const filtered = msg.content.filter((part: any) => part.type !== 'thinking');

    if (filtered.length === 0) return { ...msg, content: '' };
    if (filtered.length === 1 && filtered[0].type === 'text') {
      return { ...msg, content: (filtered[0] as any).text || '' };
    }
    return { ...msg, content: filtered };
  });
};

const patchAssistantToolCallReasoning = (messages: OpenAIChatMessage[]): OpenAIChatMessage[] =>
  messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (!hasCalls) return message;
    if ((message as any).reasoning_content !== undefined && (message as any).reasoning_content !== null) {
      return message;
    }
    return { ...message, reasoning_content: '' };
  });

const appendSearchTool = <T>(tools: T[] | undefined, enabledSearch?: boolean): T[] | undefined => {
  if (!enabledSearch) return tools;
  return tools?.length ? [...tools, MIMO_WEB_SEARCH_TOOL as T] : ([MIMO_WEB_SEARCH_TOOL] as T[]);
};

/** Exported for unit tests — Xiaomi MiMo Chat Completions request shaping. */
export const buildMimoPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const requestPayload = { ...payload };
  const enabledSearch = requestPayload.enabledSearch;
  delete requestPayload.enabledSearch;

  const {
    frequency_penalty,
    max_tokens,
    messages,
    model,
    presence_penalty,
    temperature,
    thinking,
    tool_choice,
    tools,
    top_p,
    ...rest
  } = requestPayload;

  const thinkingEnabled = isThinkingEnabled(payload);
  const mimoTools = appendSearchTool(tools, enabledSearch);
  const sanitizedMessages = stripThinkingContentBlocks(messages);
  const messagesForRequest = thinkingEnabled
    ? patchAssistantToolCallReasoning(sanitizedMessages)
    : sanitizedMessages;

  const maxCompletionTokens =
    (requestPayload as { max_completion_tokens?: number }).max_completion_tokens ?? max_tokens;

  const coercedToolChoice =
    tool_choice !== undefined && tool_choice !== 'auto' ? 'auto' : tool_choice;

  return {
    ...rest,
    messages: messagesForRequest as OpenAI.ChatCompletionMessageParam[],
    model,
    stream: payload.stream ?? true,
    ...(maxCompletionTokens !== undefined ? { max_completion_tokens: maxCompletionTokens } : {}),
    ...(shouldStripSamplingParams(thinkingEnabled)
      ? {}
      : {
          frequency_penalty,
          presence_penalty,
          temperature,
          top_p,
        }),
    ...(thinking ? { thinking: { type: thinking.type } } : {}),
    ...(coercedToolChoice !== undefined ? { tool_choice: coercedToolChoice } : {}),
    tools: mimoTools?.length ? mimoTools : undefined,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const shouldStripSamplingParams = (thinkingEnabled: boolean) => thinkingEnabled;

const fetchMimoModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ context_length?: number; id: string }> = modelsPage.data || [];
    const chatModels = modelList.filter((model) => !MIMO_NON_CHAT_ID.test(model.id));

    return processModelList(
      chatModels.map((model) => ({
        contextWindowTokens: model.context_length,
        id: model.id,
      })),
      MODEL_LIST_CONFIGS.mimo,
      ModelProvider.Mimo,
    );
  } catch (error) {
    console.warn('Failed to fetch Xiaomi MiMo models:', error);
    return [];
  }
};

export const LobeMimoAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.xiaomimimo.com/v1',
  cacheSupport: 'supported',
  chatCompletion: {
    handlePayload: buildMimoPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MIMO_CHAT_COMPLETION === '1',
  },
  models: fetchMimoModels,
  provider: ModelProvider.Mimo,
});
