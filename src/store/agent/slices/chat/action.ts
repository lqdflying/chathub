import {
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
  ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS,
  ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
  chainAssistantMemoryRollup,
} from '@lobechat/prompts';
import { TraceNameMap } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { useEffect } from 'react';
import { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { INBOX_SESSION_ID } from '@/const/session';
import type { TopicMemoryRollupRow } from '@/database/models/topic';
import {
  capAssistantMemoryByTokensAsync,
  hashText,
  normalizeAssistantMemoryText,
  rollupBackoffDelayMs,
} from '@/helpers/assistantMemory';
import {
  mutateAccountSWR,
  mutateAccountSWRByPredicate,
  useClientDataSWR,
  useOnlyFetchOnceSWR,
} from '@/libs/swr';
import { agentService } from '@/services/agent';
import { sessionService } from '@/services/session';
import { topicService } from '@/services/topic';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { AgentState } from '@/store/agent/slices/chat/initialState';
import { isSessionListCacheKey } from '@/store/session/sessionListKey';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import {
  AssistantMemoryMeta,
  AssistantMemoryTopicWatermark,
  LobeAgentChatConfig,
  LobeAgentConfig,
} from '@/types/agent';
import { KnowledgeItem } from '@/types/knowledgeBase';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { agentChatConfigSelectors, agentSelectors } from './selectors';

const nowISO = () => new Date().toISOString();

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
  /** Swap `assistantMemory` with its one-slot backup; restoring twice is a redo. */
  restoreAssistantMemoryBackup: () => Promise<boolean>;
  /**
   * Incrementally fold changed topic compaction summaries for this agent into the
   * dynamic memory doc (`assistantMemory`). Fixed memory is passed to the prompt as
   * read-only context only and is never modified.
   */
  rollupAssistantMemory: (
    options?: AssistantMemoryRollupOptions,
  ) => Promise<AssistantMemoryRollupResult>;
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

export interface AssistantMemoryRollupOptions {
  /** Rebuild from every topic summary, ignoring watermarks (manual "regenerate"). */
  force?: boolean;
  /** Scheduled runs honor the failure backoff; manual runs bypass it. */
  trigger?: 'manual' | 'scheduled';
}

export interface AssistantMemoryRollupResult {
  /** The topic listing hit its LIMIT — older topics were not considered. */
  horizonTruncated?: boolean;
  reason?: string;
  status: 'failed' | 'skipped' | 'success';
}

/** Per scope+agent single-flight guard: concurrent calls join the in-flight rollup. */
const rollupJobs = new Map<string, Promise<AssistantMemoryRollupResult>>();

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
  ) => isStoreMutationContextCurrent(checkpoint) && (isOriginatingMutationCurrent?.() ?? true);
  const refreshAgentSessions = async (
    originatingCheckpoint?: AgentMutationCheckpoint,
    isOriginatingMutationCurrent?: AgentMutationCurrentness,
  ) => {
    const checkpoint = originatingCheckpoint ?? captureStoreMutationContext();
    if (!checkpoint || !isNestedRefreshCurrent(checkpoint, isOriginatingMutationCurrent)) return;

    await mutateAccountSWRByPredicate(checkpoint.accountSnapshot.scope, (key) =>
      isSessionListCacheKey(key, checkpoint.accountSnapshot.scope),
    );
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
    restoreAssistantMemoryBackup: async () => {
      const mutationContext = captureMutationContext();
      if (!mutationContext?.activeId) return false;
      const { activeId } = mutationContext;

      const config = agentSelectors.getAgentConfigById(activeId)(get());
      const previous = config.assistantMemoryMeta?.previousMemory;
      if (!previous?.text) return false;

      const current = normalizeAssistantMemoryText(config.assistantMemory);
      await get().internal_updateAgentConfig(
        activeId,
        {
          assistantMemory: previous.text,
          assistantMemoryMeta: {
            previousMemory: current ? { at: new Date().toISOString(), text: current } : null,
          },
        },
        undefined,
        mutationContext,
        () => isMutationContextCurrent(mutationContext),
      );
      return isMutationContextCurrent(mutationContext);
    },
    rollupAssistantMemory: async (options) => {
      if (!agentChatConfigSelectors.enableAssistantMemory(get())) {
        return { reason: 'disabled', status: 'skipped' };
      }

      // currency is ACCOUNT-level only: the user may navigate to other sessions while
      // the rollup runs in the background; the result is written to the CAPTURED
      // session's agent. Only an account switch / scope reset aborts.
      const checkpoint = captureStoreMutationContext();
      if (!checkpoint) return { reason: 'no_account', status: 'failed' };

      const { activeAgentId, activeId } = get();
      if (!activeAgentId || !activeId) return { reason: 'no_agent', status: 'failed' };

      const jobKey = `${checkpoint.accountSnapshot.scope}:${activeAgentId}`;
      const inFlight = rollupJobs.get(jobKey);
      if (inFlight) return inFlight;

      const run = async (): Promise<AssistantMemoryRollupResult> => {
        const isCurrentRequest = () => isStoreMutationContextCurrent(checkpoint);
        const force = !!options?.force;

        const config = agentSelectors.getAgentConfigById(activeId)(get());
        const meta: AssistantMemoryMeta = config.assistantMemoryMeta ?? {};
        const prior = normalizeAssistantMemoryText(config.assistantMemory);
        const fixed = (config.fixedMemory ?? '').trim();

        // scheduled runs honor the failure backoff so a broken provider cannot hot-loop
        if (options?.trigger === 'scheduled' && meta.lastError) {
          const lastAt = Date.parse(meta.lastError.at);
          if (
            Number.isFinite(lastAt) &&
            Date.now() - lastAt < rollupBackoffDelayMs(meta.lastError.attempts)
          ) {
            return { reason: 'backoff', status: 'skipped' };
          }
        }

        // the deprecated-edition guard above keeps the void-returning legacy service out
        const rows =
          ((await topicService.listTopicsForAgentMemoryRollup(
            activeAgentId,
            ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
          )) as TopicMemoryRollupRow[] | undefined) ?? [];
        if (!isCurrentRequest()) return { reason: 'stale_context', status: 'failed' };

        const topics = rows.filter((row) => (row.historySummary ?? '').trim().length > 0);
        if (topics.length === 0) return { reason: 'no_summaries', status: 'skipped' };

        const horizonTruncated = rows.length >= ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS;

        // dirty = the summary text itself changed since the recorded watermark
        const watermarkByTopic = new Map(
          (meta.topicWatermarks ?? []).map((mark) => [mark.topicId, mark.summaryHash]),
        );
        const nextWatermarks: AssistantMemoryTopicWatermark[] = topics.map((topic) => ({
          summaryHash: hashText((topic.historySummary ?? '').trim()),
          topicId: topic.id,
          updatedAt: new Date(topic.updatedAt).valueOf(),
        }));
        const dirty = topics.filter(
          (topic, index) => watermarkByTopic.get(topic.id) !== nextWatermarks[index].summaryHash,
        );
        if (!force && dirty.length === 0) {
          return { horizonTruncated, reason: 'no_changes', status: 'skipped' };
        }

        const promptTopics = force ? topics : dirty;
        const incremental = !force && dirty.length < topics.length;

        const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

        const { chatService } = await import('@/services/chat');
        if (!isCurrentRequest()) return { reason: 'stale_context', status: 'failed' };

        let failureMessage: string | undefined;
        let text = '';
        try {
          await chatService.fetchPresetTaskResult({
            onError: (error) => {
              failureMessage = error?.message || 'request failed';
            },
            onFinish: async (resultText) => {
              text = resultText;
            },
            params: {
              ...chainAssistantMemoryRollup({
                fixedMemory: fixed || undefined,
                incremental,
                priorAssistantMemory: prior || undefined,
                topics: promptTopics.map((topic) => ({
                  historySummary: topic.historySummary,
                  sessionId: topic.sessionId,
                  title: topic.title,
                })),
              }),
              max_tokens: ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS,
              model,
              provider,
              stream: false,
            },
            trace: {
              sessionId: activeId,
              traceName: TraceNameMap.AssistantMemoryRollup,
            },
          });
        } catch (error) {
          failureMessage = (error as Error)?.message || 'request failed';
        }
        if (!isCurrentRequest()) return { reason: 'stale_context', status: 'failed' };

        const writeConfigPatch = async (patch: PartialDeep<LobeAgentConfig>) =>
          get().internal_updateAgentConfig(
            // the CAPTURED session id — the user may have navigated elsewhere meanwhile
            activeId,
            patch,
            undefined,
            checkpoint,
            isCurrentRequest,
          );

        // sentinel: nothing durable changed — advance watermarks, keep the doc untouched
        // (also match the normalized form in case the model wrapped it in a fence)
        const isNoChangesOutput =
          !failureMessage &&
          (text.trim() === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL ||
            normalizeAssistantMemoryText(text) === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);
        if (isNoChangesOutput) {
          await writeConfigPatch({
            assistantMemoryMeta: {
              lastError: null,
              lastRollupAt: nowISO(),
              topicWatermarks: nextWatermarks,
            },
          });
          return { horizonTruncated, reason: 'no_changes', status: 'skipped' };
        }

        const next = failureMessage
          ? ''
          : await capAssistantMemoryByTokensAsync(normalizeAssistantMemoryText(text));
        if (!isCurrentRequest()) return { reason: 'stale_context', status: 'failed' };

        if (!next) {
          // never overwrite the doc with a refusal/empty output; record the failure for backoff
          const message = failureMessage || 'empty rollup output';
          await writeConfigPatch({
            assistantMemoryMeta: {
              lastError: {
                at: nowISO(),
                attempts: (meta.lastError?.attempts ?? 0) + 1,
                message,
              },
            },
          });
          return { reason: message, status: 'failed' };
        }

        await writeConfigPatch({
          assistantMemory: next,
          // full meta object: the watermark array is replaced wholesale (config merge
          // replaces arrays), so watermarks of deleted topics prune themselves
          assistantMemoryMeta: {
            lastError: null,
            lastRollupAt: nowISO(),
            previousMemory: prior ? { at: nowISO(), text: prior } : null,
            topicWatermarks: nextWatermarks,
          },
        });
        if (!isCurrentRequest()) return { reason: 'stale_context', status: 'failed' };

        // sibling sessions bound to this agent hold their own agent-config SWR key;
        // revalidate them all so they pick up the new memory doc
        await mutateAccountSWRByPredicate(
          checkpoint.accountSnapshot.scope,
          (key) =>
            Array.isArray(key) &&
            key[0] === FETCH_AGENT_CONFIG_KEY &&
            key[1] === checkpoint.accountSnapshot.scope,
        );

        return { horizonTruncated, status: 'success' };
      };

      // surface the in-flight state in the store so UI spinners survive unmounts
      if (!get().assistantMemoryRollingAgentIds.includes(activeAgentId)) {
        set(
          {
            assistantMemoryRollingAgentIds: [
              ...get().assistantMemoryRollingAgentIds,
              activeAgentId,
            ],
          },
          false,
          'rollupAssistantMemory/start',
        );
      }

      const job = run()
        .catch((error): AssistantMemoryRollupResult => ({
          reason: (error as Error)?.message || 'exception',
          status: 'failed',
        }))
        .finally(() => {
          rollupJobs.delete(jobKey);
          set(
            {
              assistantMemoryRollingAgentIds: get().assistantMemoryRollingAgentIds.filter(
                (id) => id !== activeAgentId,
              ),
            },
            false,
            'rollupAssistantMemory/end',
          );
        });
      rollupJobs.set(jobKey, job);
      return job;
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

      try {
        await get().internal_updateAgentConfig(
          activeId,
          config,
          controller.signal,
          mutationContext,
          () => isMutationContextCurrent(mutationContext),
        );
      } finally {
        // release the shared slot once this request settles, so a later unrelated
        // config write can no longer abort an already-completed one (a post-commit
        // abort made the UI reject a write the server had persisted)
        if (get().updateAgentConfigSignal === controller) {
          set({ updateAgentConfigSignal: undefined }, false, 'updateAgentConfig/releaseSignal');
        }
      }
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
        get().updateAgentConfigSignal?.signal === signal
          ? get().updateAgentConfigSignal
          : undefined;
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
