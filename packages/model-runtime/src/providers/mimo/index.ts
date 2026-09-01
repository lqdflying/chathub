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
 * by default) on pay-as-you-go. Token Plan hosts reject that tool with
 * `webSearchEnabled is false` unless the Xiaomi Web Search plugin is on,
 * so ChatHub omits it there, keeps function/MCP tools, and search routing
 * falls back to ChatHub browsing. Structured output is `json_object` plus a
 * schema instruction — not OpenAI `json_schema`. Multi-turn tool calls in
 * thinking mode should keep `reasoning_content` on assistant messages.
 *
 * Deep thinking pass-back:
 * https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking
 */
const MIMO_WEB_SEARCH_TOOL = { type: 'web_search' } as const;
const MIMO_NON_CHAT_ID = /tts|asr|voiceclone|voicedesign/i;
const MIMO_TOKEN_PLAN_HOST = /^(?:token-plan|token-plan-[a-z0-9-]+)\.xiaomimimo\.com$/i;

/** Token Plan Chat Completions hosts (`token-plan-cn`, `token-plan-ams`, …). */
export const isMimoTokenPlanBaseURL = (baseURL?: string): boolean => {
  if (!baseURL) return false;
  try {
    const normalized = baseURL.includes('://') ? baseURL : `https://${baseURL}`;
    return MIMO_TOKEN_PLAN_HOST.test(new URL(normalized).hostname);
  } catch {
    return false;
  }
};

const isNativeWebSearchTool = (tool: unknown): boolean =>
  !!tool && typeof tool === 'object' && (tool as { type?: unknown }).type === 'web_search';

const withoutNativeWebSearch = <T>(tools: T[] | undefined): T[] | undefined => {
  if (!tools?.length) return tools;
  const filtered = tools.filter((tool) => !isNativeWebSearchTool(tool));
  return filtered.length ? filtered : undefined;
};

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

const appendSearchTool = <T>(
  tools: T[] | undefined,
  enabledSearch?: boolean,
  baseURL?: string,
): T[] | undefined => {
  // Token Plan returns 400 `webSearchEnabled is false` for `{ type: web_search }`
  // until Xiaomi Console → Plugin Management activates Web Search.
  // https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/tool-calling/web-search
  if (isMimoTokenPlanBaseURL(baseURL)) return withoutNativeWebSearch(tools);
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
 * Token Plan (`token-plan-*.xiaomimimo.com`) is stricter than pay-as-you-go:
 * undocumented ChatHub fields are stripped (whitelist), temperature is clamped
 * to `[0, 1.5]`, and native `{ type: web_search }` is omitted because Token
 * Plan rejects it with `webSearchEnabled is false` until the Web Search plugin
 * is enabled. Connectivity check passes because it sends a minimal body
 * without tools or out-of-range sampling.
 *
 * @see https://mimo.mi.com/docs/en-US/api/chat/openai-api
 * @see https://mimo.mi.com/docs/en-US/api/guidance/error-codes
 */
export const buildMimoPayload = (
  payload: ChatStreamPayload,
  options?: { baseURL?: string },
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
  const mimoTools = appendSearchTool(tools, enabledSearch, options?.baseURL);
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
    // Token Plan treats JSON `null` as an invalid parameter (400
    // `Invalid request parameters` with empty `param`). Only send numbers.
    ...(typeof frequency_penalty === 'number' ? { frequency_penalty } : {}),
    ...(typeof presence_penalty === 'number' ? { presence_penalty } : {}),
    ...(response_format != null ? { response_format } : {}),
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

/**
 * Xiaomi Chat Completions structured output is `response_format.type: json_object`
 * plus an explicit JSON instruction in messages. `json_schema`, `user`, and
 * non-`auto` `tool_choice` are not documented; Token Plan rejects undeclared
 * fields. Official guide:
 * https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output
 */
const MIMO_JSON_OBJECT_INSTRUCTION =
  'Return only compact JSON without any extra explanations, comments, or Markdown code fences. Use this JSON schema:';
const MIMO_JSON_TOOLS_INSTRUCTION =
  'Return only compact JSON without any extra explanations, comments, or Markdown code fences. Include at least one tool_calls entry. Use wait_for_user_input when that tool is offered and no agent should speak. Use this JSON schema:';

const appendMimoJsonObjectInstruction = (
  messages: unknown[],
  schema: unknown,
  instructionPrefix = MIMO_JSON_OBJECT_INSTRUCTION,
): unknown[] => {
  const instruction = `${instructionPrefix}\n${JSON.stringify(schema)}`;
  const first = messages[0] as { content?: unknown; role?: string } | undefined;
  if (first?.role === 'system' && typeof first.content === 'string') {
    return [{ ...first, content: `${first.content}\n\n${instruction}` }, ...messages.slice(1)];
  }
  return [{ content: instruction, role: 'system' }, ...messages];
};

const mimoToolFunction = (tool: unknown): Record<string, unknown> | undefined => {
  if (!tool || typeof tool !== 'object') return undefined;
  const fn = (tool as { function?: unknown }).function;
  if (!fn || typeof fn !== 'object') return undefined;
  return fn as Record<string, unknown>;
};

const mimoToolsJsonSchema = (tools: unknown[]) => {
  const functions = tools.map(mimoToolFunction).filter(Boolean) as Record<string, unknown>[];
  const names = functions
    .map((fn) => fn.name)
    .filter((name): name is string => typeof name === 'string');
  return {
    properties: {
      tool_calls: {
        items: {
          properties: {
            arguments: { type: 'object' },
            name: names.length ? { enum: names, type: 'string' } : { type: 'string' },
          },
          required: ['name', 'arguments'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
    },
    required: ['tool_calls'],
    tools: functions,
    type: 'object',
  };
};

export const shapeMimoGenerateObjectRequest = (
  payload: Record<string, any>,
): Record<string, any> => {
  const next: Record<string, any> = { ...payload };
  delete next.user;

  const tools = Array.isArray(next.tools) ? next.tools : undefined;
  // Xiaomi documents only tool_choice: auto, so required/named choices are
  // stripped and a text reply is valid. Translate tools into JSON mode so
  // generateObject still returns a parsed selection.
  // https://mimo.mi.com/docs/en-US/api/chat/openai-api
  if (tools?.length) {
    next.response_format = { type: 'json_object' };
    if (Array.isArray(next.messages)) {
      next.messages = appendMimoJsonObjectInstruction(
        next.messages,
        mimoToolsJsonSchema(tools),
        MIMO_JSON_TOOLS_INSTRUCTION,
      );
    }
    delete next.tools;
    delete next.tool_choice;
    return next;
  }

  if (next.tool_choice !== undefined && next.tool_choice !== 'auto') {
    next.tool_choice = 'auto';
  }

  const responseFormat = next.response_format as
    { json_schema?: unknown; type?: string } | undefined;
  if (responseFormat?.type === 'json_schema') {
    next.response_format = { type: 'json_object' };
    if (Array.isArray(next.messages)) {
      next.messages = appendMimoJsonObjectInstruction(next.messages, responseFormat.json_schema);
    }
  }

  return next;
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
  generateObject: {
    handlePayload: shapeMimoGenerateObjectRequest,
  },
  models: fetchMimoModels,
  provider: ModelProvider.Mimo,
});
