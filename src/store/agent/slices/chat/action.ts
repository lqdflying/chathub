import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { SWRResponse, mutate } from 'swr';
import type { PartialDeep } from 'type-fest';
import { StateCreator } from 'zustand/vanilla';

import {
  ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
  chainAssistantMemoryRollup,
} from '@lobechat/prompts';
import { TraceNameMap } from '@lobechat/types';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { INBOX_SESSION_ID } from '@/const/session';
import { normalizeAssistantMemoryText } from '@/helpers/assistantMemory';
import { useClientDataSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { agentService } from '@/services/agent';
import { sessionService } from '@/services/session';
import { topicService } from '@/services/topic';
import { AgentState } from '@/store/agent/slices/chat/initialState';
import { useSessionStore } from '@/store/session';
import { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';
import { KnowledgeItem } from '@/types/knowledgeBase';
import { merge } from '@/utils/merge';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

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
  internal_refreshAgentConfig: (id: string) => Promise<void>;
  internal_refreshAgentKnowledge: () => Promise<void>;
  internal_updateAgentConfig: (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ) => Promise<void>;
  removeFileFromAgent: (fileId: string) => Promise<void>;
  removeKnowledgeBaseFromAgent: (knowledgeBaseId: string) => Promise<void>;

  removePlugin: (id: string) => void;
  /** LLM-merge topic compaction summaries across sessions for this agent into assistantMemory. */
  rollupAssistantMemory: () => Promise<{ skipped?: boolean; success: boolean }>;
  toggleFile: (id: string, open?: boolean) => Promise<void>;
  toggleKnowledgeBase: (id: string, open?: boolean) => Promise<void>;

  togglePlugin: (id: string, open?: boolean) => Promise<void>;
  updateAgentChatConfig: (config: Partial<LobeAgentChatConfig>) => Promise<void>;
  updateAgentConfig: (config: PartialDeep<LobeAgentConfig>) => Promise<void>;
  useFetchAgentConfig: (isLogin: boolean | undefined, id: string) => SWRResponse<LobeAgentConfig>;
  useFetchFilesAndKnowledgeBases: () => SWRResponse<KnowledgeItem[]>;
  useInitInboxAgentStore: (
    isLogin: boolean | undefined,
    defaultAgentConfig?: PartialDeep<LobeAgentConfig>,
  ) => SWRResponse<PartialDeep<LobeAgentConfig>>;
}

const FETCH_AGENT_CONFIG_KEY = 'FETCH_AGENT_CONFIG';
const FETCH_AGENT_KNOWLEDGE_KEY = 'FETCH_AGENT_KNOWLEDGE';

export const createChatSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  AgentChatAction
> = (set, get) => ({
  addFilesToAgent: async (fileIds, enabled) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;
    if (fileIds.length === 0) return;

    await agentService.createAgentFiles(activeAgentId, fileIds, enabled);
    await internal_refreshAgentConfig(get().activeId);
    await internal_refreshAgentKnowledge();
  },
  addKnowledgeBaseToAgent: async (knowledgeBaseId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.createAgentKnowledgeBase(activeAgentId, knowledgeBaseId, true);
    await internal_refreshAgentConfig(get().activeId);
    await internal_refreshAgentKnowledge();
  },
  removeFileFromAgent: async (fileId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.deleteAgentFile(activeAgentId, fileId);
    await internal_refreshAgentConfig(get().activeId);
    await internal_refreshAgentKnowledge();
  },
  removeKnowledgeBaseFromAgent: async (knowledgeBaseId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.deleteAgentKnowledgeBase(activeAgentId, knowledgeBaseId);
    await internal_refreshAgentConfig(get().activeId);
    await internal_refreshAgentKnowledge();
  },

  removePlugin: async (id) => {
    await get().togglePlugin(id, false);
  },
  rollupAssistantMemory: async () => {
    const activeAgentId = get().activeAgentId;
    const activeId = get().activeId;
    if (!activeAgentId || !activeId) return { success: false };

    const rows = await topicService.listTopicsForAgentMemoryRollup(
      activeAgentId,
      ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
    );
    const topics = rows.filter((r) => (r.historySummary ?? '').trim().length > 0);
    if (topics.length === 0) return { skipped: true, success: false };

    const prior = agentSelectors.currentAgentConfig(get()).assistantMemory;
    const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

    let text = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (t) => {
        text = t;
      },
      params: {
        ...chainAssistantMemoryRollup({
          priorAssistantMemory: prior ?? undefined,
          topics: topics.map((r) => ({
            historySummary: r.historySummary,
            sessionId: r.sessionId,
            title: r.title,
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

    const next = normalizeAssistantMemoryText(text);
    if (!next) return { success: false };

    await get().updateAgentConfig({ assistantMemory: next });
    return { success: true };
  },
  toggleFile: async (id, open) => {
    const { activeAgentId, internal_refreshAgentConfig } = get();
    if (!activeAgentId) return;

    await agentService.toggleFile(activeAgentId, id, open);

    await internal_refreshAgentConfig(get().activeId);
  },
  toggleKnowledgeBase: async (id, open) => {
    const { activeAgentId, internal_refreshAgentConfig } = get();
    if (!activeAgentId) return;

    await agentService.toggleKnowledgeBase(activeAgentId, id, open);

    await internal_refreshAgentConfig(get().activeId);
  },
  togglePlugin: async (id, open) => {
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

    await get().updateAgentConfig(config);
  },
  updateAgentChatConfig: async (config) => {
    const { activeId } = get();

    if (!activeId) return;

    const nextConfig = { ...config };

    if (nextConfig.reasoningEffort !== undefined && typeof nextConfig.reasoningEffort !== 'string') {
      delete nextConfig.reasoningEffort;
    }

    await get().updateAgentConfig({ chatConfig: nextConfig });
  },

  updateAgentConfig: async (config) => {
    const { activeId } = get();

    if (!activeId) return;

    const controller = get().internal_createAbortController('updateAgentConfigSignal');

    await get().internal_updateAgentConfig(activeId, config, controller.signal);
  },
  useFetchAgentConfig: (isLogin, sessionId) =>
    useClientDataSWR<LobeAgentConfig>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true && !sessionId.startsWith('cg_')
        ? ([FETCH_AGENT_CONFIG_KEY, sessionId] as const)
        : null,
      ([, id]: readonly [string, string]) => sessionService.getSessionConfig(id),
      {
        onSuccess: (data) => {
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
    ),
  useFetchFilesAndKnowledgeBases: () => {
    return useClientDataSWR<KnowledgeItem[]>(
      [FETCH_AGENT_KNOWLEDGE_KEY, get().activeAgentId],
      ([, id]: string[]) => agentService.getFilesAndKnowledgeBases(id),
      {
        fallbackData: [],
        suspense: true,
      },
    );
  },

  useInitInboxAgentStore: (isLogin, defaultAgentConfig) =>
    useOnlyFetchOnceSWR<PartialDeep<LobeAgentConfig>>(
      // Only fetch when login status is explicitly true (not null/undefined/false)
      isLogin === true ? 'fetchInboxAgentConfig' : null,
      () => sessionService.getSessionConfig(INBOX_SESSION_ID),
      {
        onSuccess: (data) => {
          set(
            {
              defaultAgentConfig: merge(get().defaultAgentConfig, defaultAgentConfig),
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
    ),
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

  internal_updateAgentConfig: async (id, data, signal) => {
    const prevModel = agentSelectors.currentAgentModel(get());
    // optimistic update at frontend
    get().internal_dispatchAgentMap(id, data, 'optimistic_updateAgentConfig');

    await sessionService.updateSessionConfig(id, data, signal);
    await get().internal_refreshAgentConfig(id);

    // refresh sessions to update the agent config if the model has changed
    if (prevModel !== data.model) await useSessionStore.getState().refreshSessions();
  },

  internal_refreshAgentConfig: async (id) => {
    await mutate([FETCH_AGENT_CONFIG_KEY, id]);
  },

  internal_refreshAgentKnowledge: async () => {
    await mutate([FETCH_AGENT_KNOWLEDGE_KEY, get().activeAgentId]);
  },
  internal_createAbortController: (key) => {
    const abortController = get()[key] as AbortController;
    if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
    const controller = new AbortController();
    set({ [key]: controller }, false, 'internal_createAbortController');

    return controller;
  },
});
