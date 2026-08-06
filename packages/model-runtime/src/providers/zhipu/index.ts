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

// Gateway-safe thinking contract (probe-verified 2026-08-06 against a LiteLLM → vLLM
// GLM gateway and cross-checked with https://docs.z.ai/guides/capabilities/thinking):
// - `thinking.type` defaults to `enabled` on the official API, so thinking-ON sends NO
//   thinking field at all — behavior-identical upstream, and avoids gateways that
//   hard-reject the literal `type:"enabled"` with HTTP 400.
// - thinking-OFF sends `{ type: 'disabled' }` (accepted by both).
// - Preserved Thinking sends `{ clear_thinking: false }` WITHOUT `type` (official API
//   defaults type to enabled; gateways reject the explicit enabled string but accept
//   a type-less object).
// - `reasoning_effort` skip maps to `none` (documented; some gateways reject `minimal`).
// - `tool_stream` is NEVER sent: gateway backends reject it intermittently with HTTP 400
//   ("Extra inputs are not permitted, field: 'tool_stream'") and the pool rotates between
//   lenient and strict backends, so no model-id gating can be safe. Trade-off accepted:
//   tool-call arguments arrive as one chunk instead of incrementally streamed (native too).
// - Built-in web search and JSON response_format no longer force `{ type: 'disabled' }`:
//   the thinking field is omitted like normal thinking-ON, keeping the request body
//   byte-stable for implicit prefix caching (the gateway reasons regardless; on native
//   Zhipu thinking is default-on anyway). The "thinking + search mutually exclusive"
//   guard was never documented by Zhipu and is unproven on native — treated as a myth.
// When Preserved Thinking is off (Zhipu default `clear_thinking: true`), the server
// discards historical `reasoning_content`; strip the internal `reasoning` field AND
// any bare `reasoning_content` so convertOpenAIMessages does not re-inject either and
// waste input tokens. When on, keep both so the shared OpenAI context builder replays
// them as `reasoning_content`.
const normalizeMessagesForZhipu = (
  messages: ChatStreamPayload['messages'],
  preserveReasoning: boolean,
) => {
  if (preserveReasoning) return messages;
  return messages.map((message: any) => {
    if (message.role === 'assistant' && (message.reasoning || message.reasoning_content !== undefined)) {
      const { reasoning, reasoning_content, ...rest } = message;
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

  const thinkingRequested = thinking?.type !== 'disabled';
  const thinkingEnabled = supportsThinking(model) && thinkingRequested;
  const preserveReasoning = thinkingEnabled && thinking?.clear_thinking === false;

  const normalizedMessages = normalizeMessagesForZhipu(messages, preserveReasoning);

  // Gateway-safe thinking object (see contract above). Strip Anthropic-style
  // `budget_tokens` and Moonshot-style `keep` that the shared service layer may attach.
  const thinkingParam = !supportsThinking(model)
    ? undefined
    : thinkingEnabled
      ? preserveReasoning
        ? { clear_thinking: false as const } // no `type` — gateway-safe enabled form
        : undefined // thinking ON = omit (official default is enabled)
      : { type: 'disabled' as const };

  // `reasoning_effort` is GLM-5.2+ only and only meaningful when thinking is enabled.
  // The chat service maps UI 'skip' → 'none' before this point; forward verbatim.
  const reasoningEffort =
    thinkingEnabled && supportsReasoningEffort(model) ? payload.reasoning_effort : undefined;

  // `do_sample: false` selects greedy decoding; sampling params then do not apply.
  const greedy = temperature === 0;

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
  // GLM-5.x/4.x expose implicit prompt caching and report hits in
  // `usage.prompt_tokens_details.cached_tokens` (https://docs.z.ai/guides/capabilities/cache),
  // confirmed live via canary probe (stable prefix → cached_tokens > 0 on repeat, stream included).
  cacheSupport: 'supported',
  chatCompletion: {
    handlePayload: buildZhipuPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZHIPU_CHAT_COMPLETION === '1',
  },
  models: fetchZhipuModels,
  provider: ModelProvider.Zhipu,
});
