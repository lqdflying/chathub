import { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { ChatStore } from '@/store/chat/store';
import { getToolStoreState } from '@/store/tool';
import { MinimaxVisionExecutionRuntime } from '@/tools/minimax-vision/ExecutionRuntime';

export interface MinimaxVisionAction {
  analyzeImage: (
    id: string,
    params: { imageUrl: string; prompt?: string },
    aiSummary?: boolean,
  ) => Promise<boolean | undefined>;
}

const getMinimaxVisionRuntime = (): MinimaxVisionExecutionRuntime | undefined => {
  const aiInfraState = getAiInfraStoreState();
  const keyVaults = aiProviderSelectors.providerKeyVaults('minimax')(aiInfraState);
  const apiKey = keyVaults?.apiKey;
  const baseURL = keyVaults?.baseURL || 'https://api.minimax.io/v1';

  if (!apiKey) {
    console.warn('[minimaxVision] No MiniMax API key found in key vault');
    return undefined;
  }

  return new MinimaxVisionExecutionRuntime({ apiKey, baseUrl: baseURL });
};

export const minimaxVisionSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MinimaxVisionAction
> = (set, get) => ({
  analyzeImage: async (id, params, aiSummary = true) => {
    const { internal_updateMessageContent, internal_updatePluginError } = get();

    getToolStoreState().toggleBuiltinToolLoading('minimaxVision', true);

    const runtime = getMinimaxVisionRuntime();

    if (!runtime) {
      const errorContent = {
        errorMessage:
          'MiniMax API key is not configured. Please add your MiniMax API key in settings.',
        errorType: 'ConfigurationError',
      };
      await internal_updateMessageContent(id, JSON.stringify(errorContent));
      getToolStoreState().toggleBuiltinToolLoading('minimaxVision', false);
      return aiSummary;
    }

    try {
      const result: BuiltinServerRuntimeOutput = await runtime.analyzeImage(params);

      if (result.success) {
        await internal_updateMessageContent(id, result.content);
      } else {
        await internal_updatePluginError(id, {
          body: result.error,
          message: result.content || 'Vision analysis failed',
          type: 'PluginServerError',
        });
      }

      getToolStoreState().toggleBuiltinToolLoading('minimaxVision', false);
      return aiSummary;
    } catch (e) {
      const err = e as Error;
      console.error('[minimaxVision] Error:', err);
      const errorContent = {
        errorMessage: err.message || 'Unknown error during vision analysis',
        errorType: err.name || 'Error',
      };
      await internal_updateMessageContent(id, JSON.stringify(errorContent));
      getToolStoreState().toggleBuiltinToolLoading('minimaxVision', false);
      return aiSummary;
    }
  },
});
