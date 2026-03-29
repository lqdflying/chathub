import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';

// Shared constants and helpers
const MOONSHOT_SEARCH_TOOL = { function: { name: '$web_search' }, type: 'builtin_function' } as any;
const isKimiK25Model = (model: string) => model === 'kimi-k2.5';
const isKimiNativeThinkingModel = (model: string) => model.startsWith('kimi-k2-thinking');
const hasValidReasoning = (reasoning: any) => reasoning?.content && !reasoning?.signature;

const getK25Params = (isThinkingEnabled: boolean) => ({
  temperature: isThinkingEnabled ? 1 : 0.6,
  top_p: 0.95,
});

const appendSearchTool = <T>(tools: T[] | undefined, enabledSearch?: boolean): T[] | undefined => {
  if (!enabledSearch) return tools;
  return tools?.length ? [...tools, MOONSHOT_SEARCH_TOOL] : [MOONSHOT_SEARCH_TOOL];
};

// Normalize messages for Moonshot OpenAI format - reasoning_content handling only
const normalizeMessagesForMoonshot = (
  messages: ChatStreamPayload['messages'],
  forceReasoning = false,
) => {
  return messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const reasoningContent = hasValidReasoning(reasoning) ? reasoning.content : undefined;

    if (forceReasoning) {
      return { ...rest, reasoning_content: reasoningContent ?? '' };
    }
    if (reasoningContent !== undefined) {
      return { ...rest, reasoning_content: reasoningContent };
    }
    return rest;
  });
};

const buildMoonshotPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const { enabledSearch, messages, model, temperature, thinking, tools, top_p, ...rest } = payload;

  const isK25 = isKimiK25Model(model);
  const isNativeThinking = isKimiNativeThinkingModel(model);
  const isThinkingEnabled = isNativeThinking || (isK25 && thinking?.type !== 'disabled');

  // Normalize messages for reasoning_content
  const normalizedMessages = normalizeMessagesForMoonshot(
    messages,
    isThinkingEnabled,
  ) as OpenAI.ChatCompletionMessageParam[];

  // Handle search tools
  const moonshotTools = appendSearchTool(tools, enabledSearch);

  // Moonshot kimi-k2.5 requires specific parameters
  if (isK25 || isNativeThinking) {
    const thinkingParam =
      isNativeThinking || thinking?.type !== 'disabled'
        ? { type: 'enabled' as const }
        : { type: 'disabled' as const };

    return {
      ...rest,
      ...getK25Params(thinkingParam.type === 'enabled'),
      frequency_penalty: 0,
      messages: normalizedMessages,
      model,
      presence_penalty: 0,
      stream: payload.stream ?? true,
      thinking: thinkingParam,
      tools: moonshotTools?.length ? moonshotTools : undefined,
    } as OpenAI.ChatCompletionCreateParamsStreaming;
  }

  // Regular Moonshot models - temperature is normalized by dividing by 2
  return {
    ...rest,
    messages: normalizedMessages,
    model,
    stream: payload.stream ?? true,
    // Moonshot temperature is normalized by dividing by 2
    temperature: temperature !== undefined ? temperature / 2 : undefined,
    tools: moonshotTools?.length ? moonshotTools : undefined,
    // top_p is passed through (Moonshot handles it appropriately)
    top_p,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchMoonshotModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ context_length?: number; id: string; supports_image_in?: boolean }> =
      modelsPage.data || [];

    return modelList.map((model) => ({
      contextWindowTokens: model.context_length,
      id: model.id,
      vision: model.supports_image_in,
    }));
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
  chatCompletion: {
    handlePayload: buildMoonshotPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  models: fetchMoonshotModels,
  provider: ModelProvider.Moonshot,
});
