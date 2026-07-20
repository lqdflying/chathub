import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

// Shared constants and helpers
const MOONSHOT_SEARCH_TOOL = { function: { name: '$web_search' }, type: 'builtin_function' } as any;
/** kimi-k2.5 / kimi-k2.6: Moonshot accepts `thinking: { type, keep? }` per API schemas. */
const isKimiK25StyleThinkingModel = (model: string) =>
  model === 'kimi-k2.5' || model === 'kimi-k2.6';
const isKimiK27CodeModel = (model: string) => model === 'kimi-k2.7-code';
const isKimiK3Model = (model: string) => model === 'kimi-k3';
const isKimiNativeThinkingModel = (model: string) =>
  model.startsWith('kimi-k2-thinking') || isKimiK27CodeModel(model) || isKimiK3Model(model);
const shouldPreserveAssistantReasoning = (model: string) =>
  isKimiK25StyleThinkingModel(model) || isKimiK27CodeModel(model) || isKimiK3Model(model);
const hasValidReasoning = (reasoning: any) => reasoning?.content && !reasoning?.signature;

const appendSearchTool = <T>(tools: T[] | undefined, enabledSearch?: boolean): T[] | undefined => {
  if (!enabledSearch) return tools;
  return tools?.length ? [...tools, MOONSHOT_SEARCH_TOOL] : [MOONSHOT_SEARCH_TOOL];
};

// Moonshot rejects assistant messages whose content is empty and that carry no
// tool_calls (e.g. a stream that aborted before any delta arrived, a retry that
// persisted a blank bubble, or a reasoning-only turn where the final answer was
// lost). Leaving them in the history triggers:
//   "Invalid request: the message at position N with role 'assistant' must not be empty"
const hasAssistantContent = (message: any): boolean => {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  const { content } = message;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((part: any) => {
      if (!part) return false;
      if (typeof part === 'string') return part.trim().length > 0;
      if (typeof part.text === 'string') return part.text.trim().length > 0;
      // non-text parts (image_url, etc.) still count as content
      return !!part.type && part.type !== 'text';
    });
  }
  return !!content;
};

// Normalize messages for Moonshot OpenAI format:
// 1. Drop empty assistant turns that the API would otherwise reject.
// 2. Map internal `reasoning` field onto Moonshot's `reasoning_content`.
export const normalizeMessagesForMoonshot = (
  messages: ChatStreamPayload['messages'],
  forceReasoning = false,
) => {
  return messages.reduce<any[]>((acc, message: any) => {
    if (message.role !== 'assistant') {
      acc.push(message);
      return acc;
    }

    if (!hasAssistantContent(message)) return acc;

    const { reasoning, ...rest } = message;
    const reasoningContent = hasValidReasoning(reasoning)
      ? reasoning.content
      : typeof rest.reasoning_content === 'string'
        ? rest.reasoning_content
        : undefined;

    if (forceReasoning) {
      acc.push({ ...rest, reasoning_content: reasoningContent ?? '' });
    } else if (reasoningContent !== undefined) {
      acc.push({ ...rest, reasoning_content: reasoningContent });
    } else {
      acc.push(rest);
    }
    return acc;
  }, []);
};

/**
 * Kimi models with preserved thinking require every assistant message that carries
 * tool calls to include `reasoning_content` (may be empty). Some history shapes
 * omit it (e.g. tool-only turns or null content).
 */
const patchAssistantToolCallReasoning = (
  msgs: OpenAI.ChatCompletionMessageParam[],
): OpenAI.ChatCompletionMessageParam[] =>
  msgs.map((m: any) => {
    if (m?.role !== 'assistant') return m;
    const hasCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    if (!hasCalls) return m;
    if (m.reasoning_content !== undefined && m.reasoning_content !== null) return m;
    return { ...m, reasoning_content: '' };
  }) as OpenAI.ChatCompletionMessageParam[];

/** Exported for unit tests — Moonshot/OpenAI-compat request shaping. */
export const buildMoonshotPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const requestPayload = { ...payload };
  const { enabledSearch, messages, model, thinking, tools } = requestPayload;
  delete requestPayload.enabledSearch;
  delete requestPayload.frequency_penalty;
  delete requestPayload.messages;
  delete requestPayload.model;
  delete requestPayload.presence_penalty;
  delete requestPayload.temperature;
  delete requestPayload.thinking;
  delete requestPayload.tools;
  delete requestPayload.top_p;

  const isK25Style = isKimiK25StyleThinkingModel(model);
  const isK3 = isKimiK3Model(model);
  const isNativeThinking = isKimiNativeThinkingModel(model);

  // Moonshot API forbids thinking + $web_search simultaneously, so when
  // built-in search is active we treat thinking as disabled for payload shaping.
  const searchForcesThinkingOff = !!enabledSearch && (isK25Style || (isNativeThinking && !isK3));
  const isThinkingEnabled =
    !searchForcesThinkingOff && (isNativeThinking || (isK25Style && thinking?.type !== 'disabled'));

  // Normalize messages for reasoning_content
  let normalizedMessages = normalizeMessagesForMoonshot(
    messages,
    isThinkingEnabled,
  ) as OpenAI.ChatCompletionMessageParam[];

  if (shouldPreserveAssistantReasoning(model) && isThinkingEnabled) {
    normalizedMessages = patchAssistantToolCallReasoning(normalizedMessages);
  }

  // Handle search tools
  const moonshotTools = isK3 ? tools : appendSearchTool(tools, enabledSearch);

  // kimi-k2.5 / kimi-k2.6: `thinking.type` (+ optional `keep` on k2.6 for Preserved Thinking).
  if (isK25Style) {
    // Moonshot API does not support thinking + $web_search simultaneously.
    // When built-in search is active, force thinking off per official docs:
    // https://platform.kimi.ai/docs/guide/use-web-search
    const mustDisableThinking = !!enabledSearch;

    const thinkingParam =
      !mustDisableThinking && thinking?.type !== 'disabled'
        ? { type: 'enabled' as const }
        : { type: 'disabled' as const };

    const withKeep =
      model === 'kimi-k2.6' && thinkingParam.type === 'enabled' && thinking?.keep === 'all'
        ? { ...thinkingParam, keep: 'all' as const }
        : thinkingParam;

    return {
      ...requestPayload,
      messages: normalizedMessages,
      model,
      stream: payload.stream ?? true,
      thinking: withKeep,
      tools: moonshotTools?.length ? moonshotTools : undefined,
    } as OpenAI.ChatCompletionCreateParamsStreaming;
  }

  if (isK3) {
    delete requestPayload.n;
    delete requestPayload.reasoning;

    return {
      ...requestPayload,
      messages: normalizedMessages,
      model,
      reasoning_effort: 'max',
      stream: payload.stream ?? true,
      tools: moonshotTools?.length ? moonshotTools : undefined,
    } as OpenAI.ChatCompletionCreateParamsStreaming;
  }

  // kimi-k2-thinking / kimi-k2-thinking-turbo: native thinking; do not send `thinking`.
  if (isNativeThinking) {
    return {
      ...requestPayload,
      messages: normalizedMessages,
      model,
      stream: payload.stream ?? true,
      tools: moonshotTools?.length ? moonshotTools : undefined,
    } as OpenAI.ChatCompletionCreateParamsStreaming;
  }

  return {
    ...requestPayload,
    messages: normalizedMessages,
    model,
    stream: payload.stream ?? true,
    tools: moonshotTools?.length ? moonshotTools : undefined,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchMoonshotModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ context_length?: number; id: string; supports_image_in?: boolean }> =
      modelsPage.data || [];

    return processModelList(
      modelList.map((model) => ({
        contextWindowTokens: model.context_length,
        id: model.id,
        vision: model.supports_image_in,
      })),
      MODEL_LIST_CONFIGS.moonshot,
      ModelProvider.Moonshot,
    );
  } catch (error) {
    console.warn('Failed to fetch Moonshot models:', error);
    return [];
  }
};

// Enable image to base64 conversion for Moonshot API (Moonshot doesn't support image URLs)
// This must be set before any chat requests are made
if (process.env.LLM_VISION_IMAGE_USE_BASE64 !== '1') {
  process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';
}

export const LobeMoonshotAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.moonshot.cn/v1',
  cacheSupport: 'unobservable',
  chatCompletion: {
    handlePayload: buildMoonshotPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  models: fetchMoonshotModels,
  provider: ModelProvider.Moonshot,
});
