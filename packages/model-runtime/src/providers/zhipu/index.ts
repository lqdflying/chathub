import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

// `tool_stream` is documented for glm-4.6, glm-4.7, glm-5 text models only
// (https://docs.z.ai/guides/tools/stream-tool). Vision variants (glm-5v-turbo,
// glm-4.5v, glm-4.6v) use the Vision request schema, which has no tool_stream
// field; exclude them via the 'v' id heuristic.
const supportsToolStream = (model: string) => {
  if (model.includes('v')) return false;
  const match = model.match(/^glm-(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 6);
};

const ZHIPU_WEB_SEARCH_TOOL = {
  type: 'web_search',
  web_search: { enable: true, search_engine: 'search_pro_jina' },
} as any;

// Zhipu's official default is thinking enabled (https://docs.z.ai/guides/capabilities/thinking:
// `thinking.type` `enabled` is the default). ChatHub therefore OMITS the `thinking`,
// `reasoning_effort`, and `clear_thinking` request fields entirely: omitting is
// behavior-identical on the official API, and some OpenAI-compatible GLM gateways
// (LiteLLM → vLLM) hard-reject the `thinking` object with HTTP 400. With no
// Preserved Thinking in play, historical `reasoning`/`reasoning_content` is always
// stripped so convertOpenAIMessages does not re-inject it and waste input tokens.
const normalizeMessagesForZhipu = (messages: ChatStreamPayload['messages']) => {
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
    tools,
  } = payload;

  const normalizedMessages = normalizeMessagesForZhipu(messages);

  // `do_sample: false` selects greedy decoding; sampling params then do not apply.
  const greedy = temperature === 0;

  // `tool_stream` streams tool-call arguments incrementally (GLM-4.6+ text models, requires stream).
  const hasFunctionTools = Array.isArray(tools) && tools.length > 0;
  const toolStream = (payload.stream ?? true) && hasFunctionTools && supportsToolStream(model);

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
