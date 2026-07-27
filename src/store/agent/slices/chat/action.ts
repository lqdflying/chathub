import { ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS, chainAssistantMemoryRollup } from '@lobechat/prompts';
import { TraceNameMap } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { useEffect } from 'react';
import { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { INBOX_SESSION_ID } from '@/const/session';
import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { mutateAccountSWR, useClientDataSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';
import { chatService } from '@/services/chat';
import { sessionService } from '@/services/session';
import { topicService } from '@/services/topic';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { AgentState } from '@/store/agent/slices/chat/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';
import { KnowledgeItem } from '@/types/knowledgeBase';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { agentSelectors } from './selectors';

/**
 * 助手接口
 */
export interface AgentChatAction {
  addFilesToAgent: (fileIds: string[], boolean?: boolean) => Promise<void>;
  addKnowledgeBaseToAgent: (knowledgeBaseId: string) => Promise<void>;
  internal_createAbortController: (key: keyof AgentState) => AbortController;

  internal_dispatchAgentMap: (
    id: string,
    config: PartialDeep<LobeAgentConfig>,
    actions?: string,
  ) => void;
  internal_refreshAgentConfig: (
    id: string,
    checkpoint?: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) => Promise<void>;
  internal_refreshAgentKnowledge: (
    agentId?: string,
    checkpoint?: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) => Promise<void>;
  internal_updateAgentConfig: (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
    checkpoint?: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) => Promise<void>;
  removeFileFromAgent: (fileId: string) => Promise<void>;
  removeKnowledgeBaseFromAgent: (knowledgeBaseId: string) => Promise<void>;

  removePlugin: (id: string) => void;
  /** LLM-merge topic compaction summaries across sessions for this agent into assistantMemory. */
  rollupAssistantMemory: () => Promise<{ skipped?: boolean; success: boolean }>;
  toggleFile: (id: string, open?: boolean) => Promise<void>;
  toggleKnowledgeBase: (id: string, open?: boolean) => Promise<void>;

  togglePlugin: (
    id: string,
    open?: boolean,
    mutationContext?: AgentMutationContext,
  ) => Promise<void>;
  updateAgentChatConfig: (config: Partial<LobeAgentChatConfig>) => Promise<void>;
  updateAgentConfig: (
    config: PartialDeep<LobeAgentConfig>,
    mutationContext?: AgentMutationContext,
  ) => Promise<void>;
  useFetchAgentConfig: (isLogin: boolean | undefined, id: string) => SWRResponse<LobeAgentConfig>;
  useFetchFilesAndKnowledgeBases: () => SWRResponse<KnowledgeItem[]>;
  useInitInboxAgentStore: (
    isLogin: boolean | undefined,
    userScope: string | undefined,
    defaultAgentConfig?: PartialDeep<LobeAgentConfig>,
  ) => SWRResponse<PartialDeep<LobeAgentConfig>>;
}

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';
const FETCH_AGENT_KNOWLEDGE_KEY = 'FETCH_AGENT_KNOWLEDGE';
const FETCH_SESSIONS_KEY = 'fetchSessions';

interface AgentMutationCheckpoint {
  accountSnapshot: NonNullable<ReturnType<typeof captureAccountMutationSnapshot>>;
  scopeGeneration: number;
}

interface AgentMutationContext extends AgentMutationCheckpoint {
  activeAgentId?: string;
  activeId?: string;
}

type AgentMutationCurrentness = () => boolean;

export const createChatSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  AgentChatAction
> = (set, get) => {
  const captureStoreMutationContext = (): AgentMutationCheckpoint | undefined => {
    const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountSnapshot) return;

    return {
      accountSnapshot,
      scopeGeneration: get().scopeGeneration,
    };
  };
  const isStoreMutationContextCurrent = (context: AgentMutationCheckpoint) =>
    isAccountMutationCurrent(useUserStore.getState(), context.accountSnapshot) &&
    get().scopeGeneration === context.scopeGeneration;
  const captureMutationContext = (): AgentMutationContext | undefined => {
    const storeContext = captureStoreMutationContext();
    if (!storeContext) return;

    const { activeAgentId, activeId } = get();

    return {
      ...storeContext,
      activeAgentId,
      activeId,
    };
  };
  const isMutationContextCurrent = (context: AgentMutationContext) =>
    isStoreMutationContextCurrent(context) &&
    get().activeAgentId === context.activeAgentId &&
    get().activeId === context.activeId;
  const isNestedRefreshCurrent = (
    checkpoint: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) =>
    isStoreMutationContextCurrent(checkpoint) &&
    (isOriginatingMutationCurrent?.() ?? true);
  const refreshAgentSessions = async (
    originatingCheckpoint?: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) => {
    const checkpoint = originatingCheckpoint ?? captureStoreMutationContext();
    if (!checkpoint || !isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;

    await mutateAccountSWR([FETCH_SESSIONS_KEY, checkpoint.accountSnapshot.scope]);
    if (!isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;
  };

  return {
    addFilesToAgent: async (fileIds, enabled) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
      if (!activeAgentId) return;
      if (fileIds.length === 0) return;

      await agentService.createAgentFiles(activeAgentId, fileIds, enabled);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentKnowledge(activeAgentId, mutationContext, isCurrentRequest);
    },
    addKnowledgeBaseToAgent: async (knowledgeBaseId) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
      if (!activeAgentId) return;

      await agentService.createAgentKnowledgeBase(activeAgentId, knowledgeBaseId, true);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentKnowledge(activeAgentId, mutationContext, isCurrentRequest);
    },
    removeFileFromAgent: async (fileId) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
      if (!activeAgentId) return;

      await agentService.deleteAgentFile(activeAgentId, fileId);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentKnowledge(activeAgentId, mutationContext, isCurrentRequest);
    },
    removeKnowledgeBaseFromAgent: async (knowledgeBaseId) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
      if (!activeAgentId) return;

      await agentService.deleteAgentKnowledgeBase(activeAgentId, knowledgeBaseId);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentKnowledge(activeAgentId, mutationContext, isCurrentRequest);
    },

    removePlugin: async (id) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await get().togglePlugin(id, false, mutationContext);
    },
    rollupAssistantMemory: async () => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return { success: false };

      const { activeAgentId, activeId } = mutationContext;
      if (!activeAgentId || !activeId) return { success: false };

      const rows = await topicService.listTopicsForAgentMemoryRollup(
        activeAgentId,
        ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
      );
      if (!isMutationContextCurrent(mutationContext)) return { success: false };

      const topics = rows.filter((row) => (row.historySummary ?? '').trim().length > 0);
      if (topics.length === 0) return { skipped: true, success: false };

      const prior = agentSelectors.getAgentConfigById(activeId)(get()).assistantMemory;
      const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

      let text = '';
      await chatService.fetchPresetTaskResult({
        onFinish: async (resultText) => {
          text = resultText;
        },
        params: {
          ...chainAssistantMemoryRollup({
            priorAssistantMemory: prior ?? undefined,
            topics: topics.map((topic) => ({
              historySummary: topic.historySummary,
              sessionId: topic.sessionId,
              title: topic.title,
            })),
          }),
          model,
          provider,
          stream: false,
        },
        trace: {
          sessionId: activeId,
          traceName: TraceNameMap.AssistantMemoryRollup,
        },
      });
      if (!isMutationContextCurrent(mutationContext)) return { success: false };

      const next = normalizeAssistantMemoryText(text);
      if (!next) return { success: false };

      await get().internal_updateAgentConfig(
        activeId,
        { assistantMemory: next },
        undefined,
        mutationContext,
        () => isMutationContextCurrent(mutationContext),
      );
      if (!isMutationContextCurrent(mutationContext)) return { success: false };

      return { success: true };
    },
    toggleFile: async (id, open) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig } = get();
      if (!activeAgentId) return;

      await agentService.toggleFile(activeAgentId, id, open);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
    },
    toggleKnowledgeBase: async (id, open) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;
      const isCurrentRequest = () => isMutationContextCurrent(mutationContext);

      const { activeAgentId, activeId } = mutationContext;
      const { internal_refreshAgentConfig } = get();
      if (!activeAgentId) return;

      await agentService.toggleKnowledgeBase(activeAgentId, id, open);
      if (!isCurrentRequest()) return;

      await internal_refreshAgentConfig(activeId, mutationContext, isCurrentRequest);
    },
    togglePlugin: async (id, open, originatingContext) => {
      const mutationContext = originatingContext ?? captureMutationContext();
      if (!mutationContext) return;

      const originConfig = agentSelectors.currentAgentConfig(get());

      const config = produce(originConfig, (draft) => {
        draft.plugins = produce(draft.plugins || [], (plugins) => {
          const index = plugins.indexOf(id);
          const shouldOpen = open !== undefined ? open : index === -1;

          if (shouldOpen) {
            // 如果 open 为 true 或者 id 不存在于 plugins 中，则添加它
            if (index === -1) {
              plugins.push(id);
            }
          } else {
            // 如果 open 为 false 或者 id 存在于 plugins 中，则移除它
            if (index !== -1) {
              plugins.splice(index, 1);
            }
          }
        });
      });

      await get().updateAgentConfig(config, mutationContext);
    },
    updateAgentChatConfig: async (config) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      const { activeId } = mutationContext;

      if (!activeId) return;

      const nextConfig = { ...config };

      if (
        nextConfig.reasoningEffort !== undefined &&
        typeof nextConfig.reasoningEffort !== 'string'
      ) {
        delete nextConfig.reasoningEffort;
      }

      await get().updateAgentConfig({ chatConfig: nextConfig }, mutationContext);
    },

    updateAgentConfig: async (config, originatingContext) => {
      const mutationContext = originatingContext ?? captureMutationContext();
      if (!mutationContext) return;

      const { activeId } = mutationContext;

      if (!activeId) return;

      const controller = get().internal_createAbortController('updateAgentConfigSignal');

      await get().internal_updateAgentConfig(
        activeId,
        config,
        controller.signal,
        mutationContext,
        () => isMutationContextCurrent(mutationContext),
      );
    },
    useFetchAgentConfig: (isLogin, sessionId) => {
      const requestedScope = useUserStore(authSelectors.currentUserScope);

      return useClientDataSWR<LobeAgentConfig>(
        // Only fetch when login status is explicitly true (not null/undefined)
        isLogin === true && !sessionId.startsWith('cg_') && requestedScope
          ? ([FETCH_AGENT_CONFIG_KEY, requestedScope, sessionId] as const)
          : null,
        (cacheKey: readonly [string, string, string]) =>
          sessionService.getSessionConfig(cacheKey[2]),
        {
          onSuccess: (data) => {
            if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

            get().internal_dispatchAgentMap(sessionId, data, 'fetch');

            set(
              {
                activeAgentId: data.id,
                agentConfigInitMap: { ...get().agentConfigInitMap, [sessionId]: true },
              },
              false,
              'fetchAgentConfig',
            );
          },
        },
      );
    },
    useFetchFilesAndKnowledgeBases: () => {
      const requestedScope = useUserStore(authSelectors.currentUserScope);

      return useClientDataSWR<KnowledgeItem[]>(
        requestedScope ? [FETCH_AGENT_KNOWLEDGE_KEY, requestedScope, get().activeAgentId] : null,
        (cacheKey: string[]) => agentService.getFilesAndKnowledgeBases(cacheKey[2]),
        {
          fallbackData: [],
          suspense: true,
        },
      );
    },

    useInitInboxAgentStore: (isLogin, userScope, defaultAgentConfig) => {
      const requestedScope = isLogin === true ? userScope : isLogin === false ? 'guest' : undefined;
      useEffect(() => {
        if (get().inboxAgentRequestScope === requestedScope) return;

        const nextAgentMap = { ...get().agentMap };
        delete nextAgentMap[INBOX_SESSION_ID];
        set(
          {
            activeAgentId: undefined,
            agentMap: nextAgentMap,
            inboxAgentRequestScope: requestedScope,
            inboxAgentScope: undefined,
            isInboxAgentConfigInit: false,
          },
          false,
          'resetInboxAgentScope',
        );
      }, [requestedScope]);

      return useOnlyFetchOnceSWR<PartialDeep<LobeAgentConfig>>(
        // Only fetch when login status is explicitly true (not null/undefined/false)
        isLogin === true && requestedScope ? ['fetchInboxAgentConfig', requestedScope] : null,
        () => sessionService.getSessionConfig(INBOX_SESSION_ID),
        {
          onSuccess: (data) => {
            if (get().inboxAgentRequestScope !== requestedScope) return;
            if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

            set(
              {
                defaultAgentConfig: merge(get().defaultAgentConfig, defaultAgentConfig),
                inboxAgentScope: requestedScope,
                isInboxAgentConfigInit: true,
              },
              false,
              'initDefaultAgent',
            );

            if (data) {
              get().internal_dispatchAgentMap(INBOX_SESSION_ID, data, 'initInbox');
            }
          },
        },
      );
    },
    /* eslint-disable sort-keys-fix/sort-keys-fix */

    internal_dispatchAgentMap: (id, config, actions) => {
      const agentMap = produce(get().agentMap, (draft) => {
        if (!draft[id]) {
          draft[id] = config;
        } else {
          draft[id] = merge(draft[id], config);
        }
      });

      if (isEqual(get().agentMap, agentMap)) return;

      set({ agentMap }, false, 'dispatchAgent' + (actions ? `/${actions}` : ''));
    },

    internal_updateAgentConfig: async (
      id,
      data,
      signal,
      originatingCheckpoint,
      isOriginatingMutationCurrent,
    ) => {
      const mutationContext = originatingCheckpoint ?? captureStoreMutationContext();
      if (!mutationContext || signal?.aborted) return;
      const targetId = id;
      const operationController =
        get().updateAgentConfigSignal?.signal === signal ? get().updateAgentConfigSignal : undefined;
      const isCurrentRequest = () =>
        isStoreMutationContextCurrent(mutationContext) &&
        (isOriginatingMutationCurrent?.() ?? true) &&
        !signal?.aborted &&
        (!operationController || get().updateAgentConfigSignal === operationController);

      const previousModel = agentSelectors.getAgentConfigById(targetId)(get()).model;
      // optimistic update at frontend
      get().internal_dispatchAgentMap(targetId, data, 'optimistic_updateAgentConfig');

      await sessionService.updateSessionConfig(targetId, data, signal);
      if (!isCurrentRequest()) return;

      await get().internal_refreshAgentConfig(targetId, mutationContext, isCurrentRequest);
      if (!isCurrentRequest()) return;

      // refresh sessions to update the agent config if the model has changed
      if (previousModel !== data.model) {
        await refreshAgentSessions(mutationContext, isCurrentRequest);
      }
    },

    internal_refreshAgentConfig: async (
      id,
      originatingCheckpoint,
      isOriginatingMutationCurrent,
    ) => {
      const checkpoint = originatingCheckpoint ?? captureStoreMutationContext();
      if (!checkpoint || !isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;

      await mutateAccountSWR([FETCH_AGENT_CONFIG_KEY, checkpoint.accountSnapshot.scope, id]);
      if (!isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;
    },

    internal_refreshAgentKnowledge: async (
      agentId,
      originatingCheckpoint,
      isOriginatingMutationCurrent,
    ) => {
      const checkpoint = originatingCheckpoint ?? captureStoreMutationContext();
      if (!checkpoint || !isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;
      const requestedAgentId = agentId ?? get().activeAgentId;
      if (!requestedAgentId) return;
      const isRequestedResourceCurrent = () =>
        agentId !== undefined || get().activeAgentId === requestedAgentId;
      if (!isRequestedResourceCurrent()) return;

      await mutateAccountSWR([
        FETCH_AGENT_KNOWLEDGE_KEY,
        checkpoint.accountSnapshot.scope,
        requestedAgentId,
      ]);
      if (!isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;
      if (!isRequestedResourceCurrent()) return;
    },
    internal_createAbortController: (key) => {
      const abortController = get()[key] as AbortController;
      if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
      const controller = new AbortController();
      set({ [key]: controller }, false, 'internal_createAbortController');

      return controller;
    },
  };
};
