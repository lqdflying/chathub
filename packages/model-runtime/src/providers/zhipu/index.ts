import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

// https://docs.z.ai/api-reference/llm/chat-completion
// https://docs.z.ai/guides/capabilities/thinking
// Deep Thinking is supported on the GLM-5.x family and the GLM-4.5/4.6/4.7 series.
const supportsThinking = (model: string) =>
  ['glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5'].some((prefix) => model.startsWith(prefix));

// `reasoning_effort` is documented for GLM-5.2 and above only.
const supportsReasoningEffort = (model: string) => {
  const match = model.match(/^glm-(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 2);
};

const ZHIPU_WEB_SEARCH_TOOL = {
  type: 'web_search',
  web_search: { enable: true, search_engine: 'search_pro_jina' },
} as any;

// When Preserved Thinking is off (Zhipu default `clear_thinking: true`), the server
// discards historical `reasoning_content`; strip the internal `reasoning` field so
// convertOpenAIMessages does not re-inject it and waste input tokens. When on, keep
// `reasoning` so the shared OpenAI context builder replays it as `reasoning_content`.
const normalizeMessagesForZhipu = (
  messages: ChatStreamPayload['messages'],
  preserveReasoning: boolean,
) => {
  if (preserveReasoning) return messages;
  return messages.map((message: any) => {
    if (message.role === 'assistant' && message.reasoning) {
      const { reasoning, ...rest } = message;
      return rest;
    }
    return message;
  });
};

/** Exported for unit tests — Zhipu OpenAI-compatible `/chat/completions` body. */
export const buildZhipuPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const {
    enabledSearch,
    messages,
    model,
    response_format,
    temperature,
    thinking,
    tools,
  } = payload;

  // GLM-5.2: built-in web search and JSON response_format require thinking disabled.
  const wantsJson = response_format?.type === 'json_object';
  const mustDisableThinking = model === 'glm-5.2' && (!!enabledSearch || wantsJson);

  const thinkingRequested = thinking?.type !== 'disabled';
  const thinkingEnabled = supportsThinking(model) && thinkingRequested && !mustDisableThinking;
  const preserveReasoning = thinkingEnabled && thinking?.clear_thinking === false;

  const normalizedMessages = normalizeMessagesForZhipu(messages, preserveReasoning);

  // Zhipu `thinking` object: only `type` + `clear_thinking`. Strip the Anthropic-style
  // `budget_tokens` and Moonshot-style `keep` that the shared service layer may attach.
  const thinkingParam = supportsThinking(model)
    ? {
        type: thinkingEnabled ? ('enabled' as const) : ('disabled' as const),
        ...(preserveReasoning ? { clear_thinking: false as const } : {}),
      }
    : undefined;

  // `reasoning_effort` is GLM-5.2+ only and only meaningful when thinking is enabled.
  const reasoningEffort =
    thinkingEnabled && supportsReasoningEffort(model) ? payload.reasoning_effort : undefined;

  // `do_sample: false` selects greedy decoding; sampling params then do not apply.
  const greedy = temperature === 0;

  // `tool_stream` streams tool-call arguments incrementally (GLM-4.6+, requires stream).
  const hasFunctionTools = Array.isArray(tools) && tools.length > 0;
  const toolStream = (payload.stream ?? true) && hasFunctionTools;

  // Zhipu only supports `tool_choice: 'auto'`; other variants are rejected.
  const finalTools = enabledSearch
    ? [...(tools ?? []), ZHIPU_WEB_SEARCH_TOOL]
    : tools && tools.length > 0
      ? tools
      : undefined;

  return {
    max_tokens: payload.max_tokens,
    messages: normalizedMessages,
    model,
    stream: payload.stream ?? true,
    ...(thinkingParam ? { thinking: thinkingParam } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(greedy ? { do_sample: false } : {}),
    ...(toolStream ? { tool_stream: true } : {}),
    ...(finalTools ? { tools: finalTools, tool_choice: 'auto' } : {}),
    ...(response_format ? { response_format } : {}),
    ...(greedy ? {} : { temperature, top_p: payload.top_p }),
  } as unknown as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchZhipuModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ id: string }> = modelsPage.data || [];

    return processModelList(
      modelList.map((model) => ({ id: model.id })),
      MODEL_LIST_CONFIGS.zhipu,
      ModelProvider.Zhipu,
    );
  } catch (error) {
    console.warn('Failed to fetch Zhipu models:', error);
    return [];
  }
};

export const LobeZhipuAI = createOpenAICompatibleRuntime({
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  cacheSupport: 'unobservable',
  chatCompletion: {
    handlePayload: buildZhipuPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZHIPU_CHAT_COMPLETION === '1',
  },
  models: fetchZhipuModels,
  provider: ModelProvider.Zhipu,
});
