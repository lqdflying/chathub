import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

const defaultBaseURL =
  process.env.OPENAICOMPATIBLE_PROXY_URL?.trim() || 'https://api.openai.com/v1';

export const LobeOpenAICompatibleAI = createOpenAICompatibleRuntime({
  baseURL: defaultBaseURL,
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, stream, ...rest } = payload;
      return {
        ...rest,
        model,
        stream: stream ?? true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENAICOMPATIBLE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: Array<{ id: string }> = modelsPage.data || [];
      return processMultiProviderModelList(modelList, ModelProvider.OpenAICompatible);
    } catch {
      return [];
    }
  },
  provider: ModelProvider.OpenAICompatible,
});
