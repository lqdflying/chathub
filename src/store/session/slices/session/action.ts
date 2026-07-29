import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { nanoid } from 'nanoid';
import { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { sessionService } from '@/services/session';
import {
  type AccountMutationSnapshot,
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { SessionStore } from '@/store/session';
import { getUserStoreState, useUserStore } from '@/store/user';
import { authSelectors, settingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { MetaData } from '@/types/meta';
import {
  ChatSessionList,
  LobeAgentSession,
  LobeSessionGroups,
  LobeSessionType,
  LobeSessions,
  UpdateSessionParams,
} from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

import { prepareAgentSession } from './prepareAgentSession';
import { SessionDispatch, sessionsReducer } from './reducers';
import { sessionSelectors } from './selectors';
import { sessionMetaSelectors } from './selectors/meta';

const n = setNamespace('session');

const FETCH_SESSIONS_KEY = 'fetchSessions';
const SEARCH_SESSIONS_KEY = 'searchSessions';

interface SessionMutationSnapshot {
  account: AccountMutationSnapshot;
  scopeGeneration: number;
}

const captureSessionMutationSnapshot = (
  state: SessionStore,
): SessionMutationSnapshot | undefined => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return undefined;

  return {
    account,
    scopeGeneration: state.scopeGeneration,
  };
};

const isSessionMutationCurrent = (
  state: SessionStore,
  snapshot: SessionMutationSnapshot,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), snapshot.account) &&
  state.scopeGeneration === snapshot.scopeGeneration;

/* eslint-disable typescript-sort-keys/interface */
export interface SessionAction {
  /**
   * switch the session
   */
  switchSession: (sessionId: string) => void;
  /**
   * reset sessions to default
   */
  clearSessions: () => Promise<void>;
  /**
   * create a new session
   * @param agent
   * @returns sessionId
   */
  createSession: (
    session?: PartialDeep<LobeAgentSession>,
    isSwitchSession?: boolean,
  ) => Promise<string>;

  duplicateSession: (id: string) => Promise<void>;
  triggerSessionUpdate: (id: string) => Promise<void>;
  updateSessionGroupId: (sessionId: string, groupId: string) => Promise<void>;
  updateSessionMeta: (meta: Partial<MetaData>) => Promise<void>;
  updateSessionMetaById: (
    id: string,
    meta: Partial<MetaData>,
    requiredActiveId?: string,
  ) => Promise<void>;

  /**
   * Pins or unpins a session.
   */
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  /**
   * re-fetch the data
   */
  refreshSessions: () => Promise<void>;
  /**
   * remove session
   * @param id - sessionId
   */
  removeSession: (id: string) => Promise<void>;

  updateSearchKeywords: (keywords: string) => void;

  useFetchSessions: (
    enabled: boolean,
    isLogin: boolean | undefined,
  ) => SWRResponse<ChatSessionList>;
  useSearchSessions: (keyword?: string) => SWRResponse<any>;

  internal_dispatchSessions: (payload: SessionDispatch) => void;
  internal_updateSession: (id: string, data: Partial<UpdateSessionParams>) => Promise<void>;
  internal_processSessions: (
    sessions: LobeSessions,
    customGroups: LobeSessionGroups,
    actions?: string,
  ) => void;
  /* eslint-enable */
}

export const createSessionSlice: StateCreator<
  SessionStore,
  [['zustand/devtools', never]],
  [],
  SessionAction
> = (set, get) => ({
  clearSessions: async () => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return;

    await sessionService.removeAllSessions();
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
  },

  createSession: async (agent, isSwitchSession = true) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return '';

    const newSession = prepareAgentSession(
      agent,
      settingsSelectors.defaultAgent(useUserStore.getState()),
    );

    const id = await sessionService.createSession(LobeSessionType.Agent, newSession);
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return '';

    await get().refreshSessions();
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return '';

    // Track new agent creation analytics
    const analytics = getSingletonAnalyticsOptional();
    if (analytics) {
      const userStore = getUserStoreState();
      const userId = userProfileSelectors.userId(userStore);

      analytics.track({
        name: 'new_agent_created',
        properties: {
          assistant_name: newSession.meta?.title || 'Untitled Agent',
          assistant_tags: newSession.meta?.tags || [],
          session_id: id,
          user_id: userId || 'anonymous',
        },
      });
    }

    // Whether to goto  to the new session after creation, the default is to switch to
    if (isSwitchSession) get().switchSession(id);

    return id;
  },

  duplicateSession: async (id) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const session = sessionSelectors.getSessionById(id)(get());

    if (!session) return;
    const title = sessionMetaSelectors.getTitle(session.meta);

    const newTitle = t('duplicateSession.title', { ns: 'chat', title: title });

    const messageLoadingKey = `duplicateSession.loading-${nanoid(8)}`;

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    let newId: string | undefined;
    try {
      newId = await sessionService.cloneSession(id, newTitle);
    } finally {
      message.destroy(messageLoadingKey);
    }
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    // duplicate Session Error
    if (!newId) {
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await get().refreshSessions();
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    message.success(t('duplicateSession.success', { ns: 'chat' }));

    get().switchSession(newId);
  },
  pinSession: async (id, pinned) => {
    await get().internal_updateSession(id, { pinned });
  },
  removeSession: async (sessionId) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return;

    await sessionService.removeSession(sessionId);
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    // If the active session deleted, switch to the inbox session
    if (sessionId === get().activeId) {
      get().switchSession(INBOX_SESSION_ID);
    }
  },

  switchSession: (sessionId) => {
    if (get().activeId === sessionId) return;

    set({ activeId: sessionId }, false, n(`activeSession/${sessionId}`));
  },

  triggerSessionUpdate: async (id) => {
    await get().internal_updateSession(id, { updatedAt: new Date() });
  },

  updateSearchKeywords: (keywords) => {
    set(
      { isSearching: !!keywords, sessionSearchKeywords: keywords },
      false,
      n('updateSearchKeywords'),
    );
  },
  updateSessionGroupId: async (sessionId, group) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const session = sessionSelectors.getSessionById(sessionId)(get());

    if (session?.type === 'group') {
      // For group sessions (chat groups), use the chat group service
      await chatGroupService.updateGroup(sessionId, {
        groupId: group === 'default' ? null : group,
      });
      if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

      await get().refreshSessions();
    } else {
      // For regular agent sessions, use the existing session service
      await get().internal_updateSession(sessionId, { group });
    }
  },

  updateSessionMeta: async (meta) => {
    const session = sessionSelectors.currentSession(get());
    if (!session) return;

    await get().updateSessionMetaById(session.id, meta, session.id);
  },

  updateSessionMetaById: async (id, meta, requiredActiveId) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot || !get().sessions.some((session) => session.id === id)) return;

    const previousController = get().signalSessionMeta;
    if (previousController) previousController.abort(MESSAGE_CANCEL_FLAT);

    const controller = new AbortController();
    set({ signalSessionMeta: controller }, false, 'updateSessionMetaSignal');

    await sessionService.updateSessionMeta(id, meta, controller.signal);
    if (
      !isSessionMutationCurrent(get(), mutationSnapshot) ||
      get().signalSessionMeta !== controller ||
      !get().sessions.some((session) => session.id === id) ||
      (requiredActiveId !== undefined && get().activeId !== requiredActiveId)
    )
      return;

    await get().refreshSessions();
  },

  useFetchSessions: (enabled, isLogin) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);
    const shouldFetch = enabled && isLogin !== undefined && !!requestedScope;

    return useClientDataSWR<ChatSessionList>(
      shouldFetch ? [FETCH_SESSIONS_KEY, requestedScope] : null,
      () => sessionService.getGroupedSessions(),
      {
        fallbackData: {
          sessionGroups: [],
          sessions: [],
        },
        onSuccess: async (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          if (
            get().isSessionsFirstFetchFinished &&
            isEqual(get().sessions, data.sessions) &&
            isEqual(get().sessionGroups, data.sessionGroups)
          )
            return;

          get().internal_processSessions(
            data.sessions,
            data.sessionGroups,
            n('useFetchSessions/updateData') as any,
          );

          // Sync chat groups from group sessions to chat store
          const groupSessions = data.sessions.filter((session) => session.type === 'group');
          if (groupSessions.length > 0) {
            const { getChatGroupStoreState } = await import('@/store/chatGroup/store');
            if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

            // For group sessions, we need to transform them to ChatGroupItem format
            // The session ID is the chat group ID, and we can extract basic group info
            const chatGroupStore = getChatGroupStoreState();
            const chatGroups = groupSessions.map((session) => ({
              accessedAt: session.updatedAt,
              clientId: null,
              config: {
                maxResponseInRow: 3,
                orchestratorModel: 'gpt-4',
                orchestratorProvider: 'openai',
                responseOrder: 'sequential' as const,
                responseSpeed: 'medium' as const,
                scene: DEFAULT_CHAT_GROUP_CHAT_CONFIG.scene,
              },
              createdAt: session.createdAt,
              description: session.meta?.description || '',

              groupId: session.group || null,
              id: session.id, // Add the missing groupId property

              // Will be set by the backend
              pinned: session.pinned || false,

              // Session ID is the chat group ID
              slug: null,

              title: session.meta?.title || 'Untitled Group',
              updatedAt: session.updatedAt,
              userId: '', // Use updatedAt as accessedAt fallback
            }));

            chatGroupStore.internal_updateGroupMaps(chatGroups);
          }

          set({ isSessionsFirstFetchFinished: true }, false, n('useFetchSessions/onSuccess', data));
        },
        suspense: true,
      },
    );
  },
  useSearchSessions: (keyword) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<LobeSessions>(
      requestedScope ? [SEARCH_SESSIONS_KEY, requestedScope, keyword] : null,
      async () => {
        if (!keyword) return [];

        return sessionService.searchSessions(keyword);
      },
      { revalidateOnFocus: false, revalidateOnMount: false },
    );
  },

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  internal_dispatchSessions: (payload) => {
    const nextSessions = sessionsReducer(get().sessions, payload);
    get().internal_processSessions(nextSessions, get().sessionGroups);
  },
  internal_updateSession: async (id, data) => {
    const mutationSnapshot = captureSessionMutationSnapshot(get());
    if (!mutationSnapshot) return;

    get().internal_dispatchSessions({ type: 'updateSession', id, value: data });

    await sessionService.updateSession(id, data);
    if (!isSessionMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
  },
  internal_processSessions: (sessions, sessionGroups) => {
    const customGroups = sessionGroups.map((item) => ({
      ...item,
      children: sessions.filter((i) => i.group === item.id && !i.pinned),
    }));

    const defaultGroup = sessions.filter(
      (item) => (!item.group || item.group === 'default') && !item.pinned,
    );
    const pinnedGroup = sessions.filter((item) => item.pinned);

    set(
      {
        customSessionGroups: customGroups,
        defaultSessions: defaultGroup,
        pinnedSessions: pinnedGroup,
        sessionGroups,
        sessions,
      },
      false,
      n('processSessions'),
    );
  },
  refreshSessions: async () => {
    const userState = useUserStore.getState();
    const requestedScope = authSelectors.currentUserScope(userState);
    if (!requestedScope) return;

    await mutateAccountSWR([FETCH_SESSIONS_KEY, requestedScope]);
  },
});
