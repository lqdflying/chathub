import { ModelProvider, minimax as minimaxChatModels } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import type { ChatStreamPayload } from '../../types';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { createMiniMaxImage } from './createImage';

export const getMinimaxMaxOutputs = (modelId: string): number | undefined => {
  const model = minimaxChatModels.find((model) => model.id === modelId);
  return model ? model.maxOutput : undefined;
};

/** Exported for unit tests — MiniMax OpenAI-compatible `/v1/chat/completions` body. */
export const buildMinimaxOpenAIChatPayload = (payload: ChatStreamPayload) => {
  const { max_tokens, messages, temperature, tools, top_p, ...params } = payload;

  // Interleaved thinking
  const processedMessages = messages.map((message: any) => {
    if (message.role === 'assistant' && message.reasoning) {
      // 只处理没有 signature 的历史推理内容
      if (!message.reasoning.signature && message.reasoning.content) {
        const { reasoning, ...messageWithoutReasoning } = message;
        return {
          ...messageWithoutReasoning,
          reasoning_details: [
            {
              format: 'MiniMax-response-v1',
              id: 'reasoning-text-0',
              index: 0,
              text: reasoning.content,
              type: 'reasoning.text',
            },
          ],
        };
      }

      // 有 signature 或没有 content 的情况，移除 reasoning 字段
      // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
      const { reasoning, ...messageWithoutReasoning } = message;
      return messageWithoutReasoning;
    }
    return message;
  });

  // Resolve parameters with constraints
  const resolvedParams = resolveParameters(
    {
      max_tokens: max_tokens !== undefined ? max_tokens : getMinimaxMaxOutputs(payload.model),
      temperature,
      top_p,
    },
    {
      normalizeTemperature: true,
      topPRange: { max: 1, min: 0.01 },
    },
  );

  // Minimax doesn't support temperature <= 0
  const finalTemperature =
    resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
      ? undefined
      : resolvedParams.temperature;

  const reasoning_split = payload.reasoning_split !== false;

  return {
    ...params,
    max_tokens: resolvedParams.max_tokens,
    messages: processedMessages,
    reasoning_split,
    temperature: finalTemperature,
    tools,
    top_p: resolvedParams.top_p,
  } as any;
};

const fetchMinimaxModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ created?: number; id: string }> = modelsPage.data || [];

    return processModelList(
      modelList.map((model) => ({
        created: model.created,
        id: model.id,
      })),
      MODEL_LIST_CONFIGS.minimax,
      ModelProvider.Minimax,
    );
  } catch (error) {
    console.warn('Failed to fetch MiniMax models:', error);
    return [];
  }
};

export const LobeMinimaxAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.minimax.io/v1',
  cacheSupport: 'unobservable',
  chatCompletion: {
    handlePayload: buildMinimaxOpenAIChatPayload,
  },
  createImage: createMiniMaxImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CHAT_COMPLETION === '1',
  },
  models: fetchMinimaxModels,
  provider: ModelProvider.Minimax,
});
