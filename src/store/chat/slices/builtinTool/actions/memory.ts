import { StateCreator } from 'zustand/vanilla';

import {
  appendFixedMemoryEntry,
  deleteFixedMemoryEntry,
  formatFixedMemoryEntries,
  isMemoryWriteTainted,
  MEMORY_TAINT_WINDOW,
  mergeNewEntryOrigins,
  readAssistantMemory,
  searchAssistantMemory,
  updateFixedMemoryEntry,
} from '@/helpers/assistantMemory';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { builtinTools } from '@/tools';

const BUILTIN_TOOL_IDENTIFIERS = new Set(builtinTools.map((tool) => tool.identifier));
const isBuiltinToolIdentifier = (identifier: string) => BUILTIN_TOOL_IDENTIFIERS.has(identifier);

export interface MemoryAction {
  deleteMemory: (
    id: string,
    params: { index: number; match: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
  readMemory: (
    id: string,
    params?: Record<string, never>,
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
  saveMemory: (
    id: string,
    params: { content: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
  searchMemory: (
    id: string,
    params: { limit?: number; query: string },
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
        //
        // M2 provenance: entries authored by this write are tagged `agent`,
        // downgraded to `untrusted` when the writing turn's recent history
        // contains external (MCP / web) tool output.
        const tainted = isMemoryWriteTainted(
          chatSelectors.mainDisplayChats(get()).slice(-MEMORY_TAINT_WINDOW),
          isBuiltinToolIdentifier,
        );
        const newOrigins = mergeNewEntryOrigins(
          config.fixedMemory,
          outcome.doc,
          config.assistantMemoryMeta?.entryOrigins,
          tainted ? 'untrusted' : 'agent',
        );
        await getAgentStoreState().internal_updateAgentConfig(activeId, {
          assistantMemoryMeta: {
            ...config.assistantMemoryMeta,
            entryOrigins: { ...config.assistantMemoryMeta?.entryOrigins, ...newOrigins },
          },
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

  /**
   * Read-only memory recall (searchMemory/readMemory): same gates as writes,
   * but no write queue and no agent-config mutation.
   */
  const runMemoryRead = async (
    id: string,
    aiSummary: boolean,
    read: (config: { assistantMemory?: string | null; fixedMemory?: string | null }) => object,
  ): Promise<boolean | undefined> => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

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
      const result = read(config);
      if (!invocationIsCurrent()) return false;
      await get().internal_updateMessageContent(id, JSON.stringify(result));
    } catch (error) {
      if (!invocationIsCurrent()) return false;
      await get().internal_updatePluginError(id, {
        message: (error as Error)?.message || 'failed to read memory',
        type: 'PluginServerError',
      });
    }

    return aiSummary;
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
    readMemory: async (id, _params, aiSummary = true) =>
      runMemoryRead(id, aiSummary, (config) =>
        readAssistantMemory({
          dynamicMemory: config.assistantMemory,
          fixedMemory: config.fixedMemory,
        }),
      ),
    searchMemory: async (id, params, aiSummary = true) =>
      runMemoryRead(id, aiSummary, (config) => {
        const query = (params?.query ?? '').trim();
        if (!query) return { error: 'searchMemory requires a non-empty query' };
        return {
          hits: searchAssistantMemory({
            dynamicMemory: config.assistantMemory,
            fixedMemory: config.fixedMemory,
            limit: params?.limit,
            query,
          }),
        };
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
