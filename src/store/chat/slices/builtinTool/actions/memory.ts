import { StateCreator } from 'zustand/vanilla';

import { appendFixedMemoryEntry } from '@/helpers/assistantMemory';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { ChatStore } from '@/store/chat/store';

export interface MemoryAction {
  saveMemory: (
    id: string,
    params: { content: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
}

/**
 * Tool calls in one assistant turn run concurrently; appending to the fixed-memory
 * doc is a read-modify-write, so saves are serialized through this chain to keep
 * numbering monotonic and writes lossless.
 */
let saveMemoryQueue: Promise<unknown> = Promise.resolve();

export const memorySlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MemoryAction
> = (set, get) => ({
  saveMemory: async (id, params, aiSummary = true) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

    const run = async (): Promise<boolean | undefined> => {
      const content = (params?.content ?? '').trim();
      if (!content) {
        await get().internal_updatePluginError(id, {
          message: 'saveMemory requires non-empty content',
          type: 'PluginServerError',
        });
        return aiSummary;
      }

      const agentState = getAgentStoreState();
      const activeId = agentState.activeId;

      if (!activeId || !agentChatConfigSelectors.enableAssistantMemory(agentState)) {
        await get().internal_updatePluginError(id, {
          message: 'assistant memory is disabled for this assistant',
          type: 'PluginServerError',
        });
        return aiSummary;
      }

      try {
        const config = agentSelectors.getAgentConfigById(activeId)(agentState);
        const { doc, index } = appendFixedMemoryEntry(config.fixedMemory, content);

        // direct id-targeted write: does NOT touch the shared abortable
        // updateAgentConfigSignal slot (see the canary.2 stale-abort fix)
        await getAgentStoreState().internal_updateAgentConfig(activeId, { fixedMemory: doc });
        if (!invocationIsCurrent()) return false;

        await get().internal_updateMessageContent(
          id,
          JSON.stringify({ content, index, saved: true }),
        );
      } catch (error) {
        if (!invocationIsCurrent()) return false;
        await get().internal_updatePluginError(id, {
          message: (error as Error)?.message || 'failed to save memory',
          type: 'PluginServerError',
        });
      }

      return aiSummary;
    };

    // serialize; a failed predecessor must not break the chain
    const job = saveMemoryQueue.then(run, run);
    saveMemoryQueue = job.catch(() => undefined);
    return job;
  },
});
