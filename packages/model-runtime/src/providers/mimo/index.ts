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
 * and top_p are ignored upstream, so they are stripped. Penalty fields remain
 * valid. Official max-token field is `max_completion_tokens`. `tool_choice`
 * only accepts `auto`.
 *
 * Native web search is `{ type: 'web_search' }` in `tools` (no force_search
 * by default). Multi-turn tool calls in thinking mode should keep
 * `reasoning_content` on assistant messages.
 *
 * Deep thinking pass-back:
 * https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking
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

const storedAssistantReasoning = (message: OpenAIChatMessage): string | undefined => {
  const internal = (message as { reasoning?: { content?: unknown } }).reasoning?.content;
  return typeof internal === 'string' && internal.length > 0 ? internal : undefined;
};

/**
 * Xiaomi requires historical `reasoning_content` on thinking-mode tool turns.
 * ChatHub stores streamed reasoning as `message.reasoning.content`; injecting
 * `''` would hide that value from `convertOpenAIMessages`.
 */
const patchAssistantToolCallReasoning = (messages: OpenAIChatMessage[]): OpenAIChatMessage[] =>
  messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (!hasCalls) return message;

    const bare = (message as { reasoning_content?: unknown }).reasoning_content;
    const internal = storedAssistantReasoning(message);

    if (internal) {
      // Empty string and null are authoritative downstream and hide stored
      // reasoning from convertOpenAIMessages (it only falls back when the
      // bare field is undefined).
      if (bare === '' || bare === null) {
        return { ...message, reasoning_content: internal };
      }
      return message;
    }

    if (bare !== undefined && bare !== null) return message;
    return { ...message, reasoning_content: '' };
  });

const appendSearchTool = <T>(tools: T[] | undefined, enabledSearch?: boolean): T[] | undefined => {
  if (!enabledSearch) return tools;
  return tools?.length ? [...tools, MIMO_WEB_SEARCH_TOOL as T] : ([MIMO_WEB_SEARCH_TOOL] as T[]);
};

/** Official Chat Completions temperature range: [0, 1.5]. */
const clampMimoTemperature = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(1.5, Math.max(0, value));
};

/** Official Chat Completions top_p range: [0.01, 1.0]. */
const clampMimoTopP = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(1, Math.max(0.01, value));
};

const clampMimoMaxCompletionTokens = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(131_072, Math.max(1, Math.floor(value)));
};

/**
 * Exported for unit tests — Xiaomi MiMo Chat Completions request shaping.
 *
 * Token Plan (`token-plan-cn.xiaomimimo.com`) returns HTTP 400
 * `Invalid request parameters` when undocumented ChatHub fields leak through
 * (`enabledContextCaching`, `n`, `responseMode`, `reasoning_effort`, etc.).
 * Connectivity check passes because it only sends a minimal body; full chat
 * must emit a whitelist of official fields only.
 *
 * @see https://mimo.mi.com/docs/en-US/api/chat/openai-api
 * @see https://mimo.mi.com/docs/en-US/api/guidance/error-codes
 */
export const buildMimoPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const enabledSearch = payload.enabledSearch;
  const {
    frequency_penalty,
    max_tokens,
    messages,
    model,
    presence_penalty,
    response_format,
    stop,
    temperature,
    thinking,
    tool_choice,
    tools,
    top_p,
  } = payload;

  const thinkingEnabled = isThinkingEnabled(payload);
  const mimoTools = appendSearchTool(tools, enabledSearch);
  const sanitizedMessages = stripThinkingContentBlocks(messages);
  const messagesForRequest = thinkingEnabled
    ? patchAssistantToolCallReasoning(sanitizedMessages)
    : sanitizedMessages;

  const maxCompletionTokens = clampMimoMaxCompletionTokens(
    (payload as { max_completion_tokens?: number }).max_completion_tokens ?? max_tokens,
  );

  const coercedToolChoice =
    tool_choice !== undefined && tool_choice !== 'auto' ? 'auto' : tool_choice;

  const clampedTemperature = clampMimoTemperature(temperature);
  const clampedTopP = clampMimoTopP(top_p);

  return {
    messages: messagesForRequest as OpenAI.ChatCompletionMessageParam[],
    model,
    stream: payload.stream ?? true,
    ...(maxCompletionTokens !== undefined ? { max_completion_tokens: maxCompletionTokens } : {}),
    ...(frequency_penalty !== undefined ? { frequency_penalty } : {}),
    ...(presence_penalty !== undefined ? { presence_penalty } : {}),
    ...(response_format !== undefined ? { response_format } : {}),
    ...(stop !== undefined && stop !== null ? { stop } : {}),
    ...(!thinkingEnabled && clampedTemperature !== undefined
      ? { temperature: clampedTemperature }
      : {}),
    ...(!thinkingEnabled && clampedTopP !== undefined ? { top_p: clampedTopP } : {}),
    ...(thinking ? { thinking: { type: thinking.type } } : {}),
    ...(coercedToolChoice !== undefined ? { tool_choice: coercedToolChoice } : {}),
    ...(mimoTools?.length ? { tools: mimoTools } : {}),
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

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
    // `stream_options` / `user` are not on Xiaomi's Chat Completions schema;
    // Token Plan has returned 400 for undeclared fields.
    excludeUsage: true,
    handlePayload: buildMimoPayload,
    noUserId: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MIMO_CHAT_COMPLETION === '1',
  },
  models: fetchMimoModels,
  provider: ModelProvider.Mimo,
});
