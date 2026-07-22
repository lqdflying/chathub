import { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { ChatStore } from '@/store/chat/store';
import { getToolStoreState } from '@/store/tool';
import { MinimaxVisionExecutionRuntime } from '@/tools/minimax-vision/ExecutionRuntime';

export interface MinimaxVisionAction {
  analyzeImage: (
    id: string,
    params: { imageUrl: string; prompt?: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
}

const getMinimaxVisionRuntime = (): MinimaxVisionExecutionRuntime => {
  // API key and base URL are read server-side from Docker env vars
  // via the tools.minimaxVision tRPC endpoint
  return new MinimaxVisionExecutionRuntime();
};

export const minimaxVisionSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MinimaxVisionAction
> = (set, get) => ({
  analyzeImage: async (id, params, aiSummary = true, diagnosticId) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () =>
      get().conversationClearGeneration === invocationGeneration;

    getToolStoreState().toggleBuiltinToolLoading('minimaxVision', true);

    const runtime = getMinimaxVisionRuntime();

    try {
      const result: BuiltinServerRuntimeOutput = await runtime.analyzeImage(params, {
        diagnosticId,
      });
      if (!invocationIsCurrent()) return false;

      if (result.success) {
        await get().internal_updateMessageContent(id, result.content);
      } else {
        await get().internal_updatePluginError(id, {
          body: result.error,
          message: result.content || 'Vision analysis failed',
          type: 'PluginServerError',
        });
      }
      if (!invocationIsCurrent()) return false;

      getToolStoreState().toggleBuiltinToolLoading('minimaxVision', false);
      return aiSummary;
    } catch (e) {
      if (!invocationIsCurrent()) return false;

      const err = e as Error;
      console.error('[minimaxVision] Error:', err);
      const errorContent = {
        errorMessage: err.message || 'Unknown error during vision analysis',
        errorType: err.name || 'Error',
      };
      await get().internal_updateMessageContent(id, JSON.stringify(errorContent));
      if (!invocationIsCurrent()) return false;

      getToolStoreState().toggleBuiltinToolLoading('minimaxVision', false);
      return aiSummary;
    }
  },
});
