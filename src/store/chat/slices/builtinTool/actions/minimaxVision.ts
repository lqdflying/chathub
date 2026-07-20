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
    const { internal_updateMessageContent, internal_updatePluginError } = get();

    getToolStoreState().toggleBuiltinToolLoading('minimaxVision', true);

    const runtime = getMinimaxVisionRuntime();

    try {
      const result: BuiltinServerRuntimeOutput = await runtime.analyzeImage(params, {
        diagnosticId,
      });

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
