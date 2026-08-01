import { StateCreator } from 'zustand/vanilla';

import {
  appendFixedMemoryEntry,
  deleteFixedMemoryEntry,
  formatFixedMemoryEntries,
  updateFixedMemoryEntry,
} from '@/helpers/assistantMemory';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { ChatStore } from '@/store/chat/store';

export interface MemoryAction {
  deleteMemory: (
    id: string,
    params: { index: number; match: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
  saveMemory: (
    id: string,
    params: { content: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
  updateMemory: (
    id: string,
    params: { content: string; index: number; match: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
}

/**
 * Tool calls in one assistant turn run concurrently; every fixed-memory write is
 * a read-modify-write on one doc, so save/update/delete all serialize through
 * this chain to keep numbering monotonic and writes lossless.
 */
let memoryWriteQueue: Promise<unknown> = Promise.resolve();

type MemoryWriteOutcome =
  | { error: string }
  | { errorResult: object }
  | { result: object; doc: string };

export const memorySlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MemoryAction
> = (set, get) => {
  /** Shared gates + serialized write + result/error reporting for all three APIs. */
  const runMemoryWrite = async (
    id: string,
    aiSummary: boolean,
    mutate: (currentDoc: string | null | undefined) => MemoryWriteOutcome,
  ): Promise<boolean | undefined> => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

    const run = async (): Promise<boolean | undefined> => {
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
        const outcome = mutate(config.fixedMemory);

        if ('error' in outcome) {
          await get().internal_updatePluginError(id, {
            message: outcome.error,
            type: 'PluginServerError',
          });
          return aiSummary;
        }

        if ('errorResult' in outcome) {
          // verification failures go back as TOOL RESULT content so the model can
          // read the fresh entry list and self-correct within the same turn
          await get().internal_updateMessageContent(id, JSON.stringify(outcome.errorResult));
          return aiSummary;
        }

        // direct id-targeted write: does NOT touch the shared abortable
        // updateAgentConfigSignal slot (see the canary.2 stale-abort fix)
        await getAgentStoreState().internal_updateAgentConfig(activeId, {
          fixedMemory: outcome.doc,
        });
        if (!invocationIsCurrent()) return false;

        await get().internal_updateMessageContent(id, JSON.stringify(outcome.result));
      } catch (error) {
        if (!invocationIsCurrent()) return false;
        await get().internal_updatePluginError(id, {
          message: (error as Error)?.message || 'failed to write memory',
          type: 'PluginServerError',
        });
      }

      return aiSummary;
    };

    // serialize; a failed predecessor must not break the chain
    const job = memoryWriteQueue.then(run, run);
    memoryWriteQueue = job.catch(() => undefined);
    return job;
  };

  return {
    deleteMemory: async (id, params, aiSummary = true) =>
      runMemoryWrite(id, aiSummary, (currentDoc) => {
        const index = Number(params?.index);
        const match = (params?.match ?? '').trim();
        if (!Number.isInteger(index) || !match)
          return { error: 'deleteMemory requires index and match' };

        const outcome = deleteFixedMemoryEntry(currentDoc, index, match);
        if ('error' in outcome) {
          return {
            errorResult: {
              currentEntries: formatFixedMemoryEntries(outcome.entries),
              error: outcome.error,
            },
          };
        }
        return {
          doc: outcome.doc,
          result: { deleted: true, index, renumbered: true },
        };
      }),
    saveMemory: async (id, params, aiSummary = true) =>
      runMemoryWrite(id, aiSummary, (currentDoc) => {
        const content = (params?.content ?? '').trim();
        if (!content) return { error: 'saveMemory requires non-empty content' };

        const { doc, index } = appendFixedMemoryEntry(currentDoc, content);
        return { doc, result: { content, index, saved: true } };
      }),
    updateMemory: async (id, params, aiSummary = true) =>
      runMemoryWrite(id, aiSummary, (currentDoc) => {
        const index = Number(params?.index);
        const match = (params?.match ?? '').trim();
        const content = (params?.content ?? '').trim();
        if (!Number.isInteger(index) || !match || !content)
          return { error: 'updateMemory requires index, match, and content' };

        const outcome = updateFixedMemoryEntry(currentDoc, index, match, content);
        if ('error' in outcome) {
          return {
            errorResult: {
              currentEntries: formatFixedMemoryEntries(outcome.entries),
              error: outcome.error,
            },
          };
        }
        return {
          doc: outcome.doc,
          result: { content: outcome.entry.content, index, updated: true },
        };
      }),
  };
};
