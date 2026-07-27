import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import type { ChatStoreState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import { setNamespace } from '@/utils/storeDebug';

import {
  ChatGroupAction,
  ChatGroupState,
  ChatGroupStore,
  initialChatGroupState,
} from './initialState';
import { ChatGroupReducer, chatGroupReducers } from './reducers';
import { chatGroupSelectors } from './selectors';

const n = setNamespace('chatGroup');

const FETCH_GROUPS_KEY = 'fetchGroups';
const FETCH_GROUP_DETAIL_KEY = 'fetchGroupDetail';

const syncChatStoreGroupMap = (groupMap: Record<string, ChatGroupItem>) => {
  useChatStore.setState(
    produce((state: ChatStoreState) => {
      state.groupMaps = groupMap;
      state.groupsInit = true;
    }),
    false,
    n('syncGroupMap/chat'),
  );
};

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (set, get) => {
  const dispatch: ChatGroupAction['internal_dispatchChatGroup'] = (payload) => {
    set(
      produce((draft: ChatGroupState) => {
        const reducer = chatGroupReducers[
          payload.type as keyof typeof chatGroupReducers
        ] as ChatGroupReducer;
        if (reducer) {
          // Apply the reducer and return the new state
          return reducer(draft, payload);
        }
      }),
      false,
      payload,
    );
  };
  const captureMutationContext = () => {
    const accountSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountSnapshot) return;

    return {
      accountSnapshot,
      scopeGeneration: get().scopeGeneration,
    };
  };
  const isMutationContextCurrent = (
    context: NonNullable<ReturnType<typeof captureMutationContext>>,
  ) =>
    isAccountMutationCurrent(useUserStore.getState(), context.accountSnapshot) &&
    get().scopeGeneration === context.scopeGeneration;

  return {
    ...initialChatGroupState,

    addAgentsToGroup: async (groupId, agentIds) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await chatGroupService.addAgentsToGroup(groupId, agentIds);
      if (!isMutationContextCurrent(mutationContext)) return;

      await get().internal_refreshGroups();
    },

    /**
     * @param silent - if true, do not switch to the new group session
     */
    createGroup: async (newGroup, agentIds, silent = false, virtualSessions) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return '';

      const sessionState = getSessionStoreState();
      const requestedSessionId = sessionState.activeId;
      const requestedSessionGeneration = sessionState.scopeGeneration;
      const isSessionContextCurrent = () => {
        const currentSessionState = getSessionStoreState();

        return (
          isMutationContextCurrent(mutationContext) &&
          currentSessionState.scopeGeneration === requestedSessionGeneration &&
          currentSessionState.activeId === requestedSessionId
        );
      };

      const { group, virtualMembers } = await chatGroupService.createGroup({
        agentIds,
        group: newGroup,
        virtualSessions,
      });
      if (!isMutationContextCurrent(mutationContext)) return '';

      const analytics = getSingletonAnalyticsOptional();
      if (analytics && virtualSessions) {
        const userId = userProfileSelectors.userId(useUserStore.getState());
        for (const [index, virtualMember] of virtualMembers.entries()) {
          const virtualSession = virtualSessions[index];
          analytics.track({
            name: 'new_agent_created',
            properties: {
              assistant_name: virtualSession?.config.title || 'Untitled Agent',
              assistant_tags: virtualSession?.config.tags || [],
              session_id: virtualMember.sessionId,
              user_id: userId || 'anonymous',
            },
          });
        }
      }

      dispatch({ payload: group, type: 'addGroup' });

      await get().loadGroups();
      if (!isMutationContextCurrent(mutationContext)) return '';

      await getSessionStoreState().refreshSessions();
      if (!isMutationContextCurrent(mutationContext)) return '';

      if (!silent && isSessionContextCurrent()) {
        getSessionStoreState().switchSession(group.id);
      }

      return group.id;
    },
    deleteGroup: async (id) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      const requestedSessionGeneration = getSessionStoreState().scopeGeneration;

      // First, get all group members to identify virtual members
      const groupAgents = await chatGroupService.getGroupAgents(id);
      if (!isMutationContextCurrent(mutationContext)) return;

      // Delete the group first (this will cascade delete the chat_groups_agents entries)
      await chatGroupService.deleteGroup(id);
      if (!isMutationContextCurrent(mutationContext)) return;

      dispatch({ payload: id, type: 'deleteGroup' });

      // Now delete virtual members (agents with virtual: true)
      const sessionStore = getSessionStoreState();
      const sessions = sessionStore.sessions || [];

      // Find and delete all virtual sessions that were members of this group
      const virtualMemberDeletions = groupAgents
        .map((groupAgent) => {
          // groupAgent has agentId property from the junction table
          const session = sessions.find((s) => {
            // Type guard: check if it's an agent session
            if (s.type === 'agent') {
              return s.config?.id === groupAgent.agentId;
            }
            return false;
          });

          // Only delete if the session exists and has virtual flag set to true
          if (session && session.type === 'agent' && session.config?.virtual) {
            return sessionStore.removeSession(session.id);
          }
          return null;
        })
        .filter(Boolean);

      // Wait for all virtual member deletions to complete
      await Promise.all(virtualMemberDeletions);
      if (!isMutationContextCurrent(mutationContext)) return;

      await get().loadGroups();
      if (!isMutationContextCurrent(mutationContext)) return;

      await getSessionStoreState().refreshSessions();
      if (!isMutationContextCurrent(mutationContext)) return;

      // If the active session is the deleted group, switch to the inbox session
      const currentSessionState = getSessionStoreState();
      if (
        currentSessionState.scopeGeneration === requestedSessionGeneration &&
        currentSessionState.activeId === id
      ) {
        currentSessionState.switchSession(INBOX_SESSION_ID);
      }
    },

    internal_dispatchChatGroup: dispatch,

    internal_refreshGroups: async () => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await get().loadGroups();
      if (!isMutationContextCurrent(mutationContext)) return;

      // Also rebuild and update groupMap to keep it in sync
      const groups = await chatGroupService.getGroups();
      if (!isMutationContextCurrent(mutationContext)) return;

      const nextGroupMap = groups.reduce(
        (map, group) => {
          map[group.id] = group;
          return map;
        },
        {} as Record<string, ChatGroupItem>,
      );

      if (!isEqual(get().groupMap, nextGroupMap)) {
        set(
          {
            groupMap: nextGroupMap,
            groupsInit: true,
            isGroupsLoading: false,
          },
          false,
          n('internal_refreshGroups/updateGroupMap'),
        );

        syncChatStoreGroupMap(nextGroupMap);
      }

      // Refresh sessions so session-related group info stays up to date
      await getSessionStoreState().refreshSessions();
    },

    internal_updateGroupMaps: (groups) => {
      // Build a candidate map from incoming groups
      const incomingMap = groups.reduce(
        (map, group) => {
          map[group.id] = group;
          return map;
        },
        {} as Record<string, ChatGroupItem>,
      );

      // Merge with existing map, preserving existing config if present
      const mergedMap = produce(get().groupMap, (draft) => {
        for (const id of Object.keys(incomingMap)) {
          const incoming = incomingMap[id];
          const existing = draft[id];
          if (existing) {
            draft[id] = {
              ...existing,
              ...incoming,
              // Keep existing config (authoritative) if present; do not overwrite
              config: existing.config || incoming.config,
            } as ChatGroupItem;
          } else {
            draft[id] = incoming;
          }
        }
      });

      set(
        {
          groupMap: mergedMap,
          groupsInit: true,
          isGroupsLoading: false,
        },
        false,
        n('internal_updateGroupMaps/chatGroup'),
      );

      syncChatStoreGroupMap(mergedMap);
    },

    loadGroups: async () => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      dispatch({ payload: true, type: 'setGroupsLoading' });
      const groups = await chatGroupService.getGroups();
      if (!isMutationContextCurrent(mutationContext)) return;

      dispatch({ payload: groups, type: 'loadGroups' });
    },

    pinGroup: async (id, pinned) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await get().updateGroup(id, { pinned });
    },

    refreshGroupDetail: async (groupId: string) => {
      const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
      if (!requestedScope) return;

      await mutateAccountSWR([FETCH_GROUP_DETAIL_KEY, requestedScope, groupId]);
    },

    refreshGroups: async () => {
      const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
      if (!requestedScope) return;

      await mutateAccountSWR([FETCH_GROUPS_KEY, requestedScope]);
    },

    removeAgentFromGroup: async (groupId, agentId) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await chatGroupService.removeAgentsFromGroup(groupId, [agentId]);
      if (!isMutationContextCurrent(mutationContext)) return;

      await get().internal_refreshGroups();
    },

    reorderGroupMembers: async (groupId, orderedAgentIds) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      console.log('REORDER GROUP MEMBERS', groupId, orderedAgentIds);

      await Promise.all(
        orderedAgentIds.map((agentId, index) =>
          chatGroupService.updateAgentInGroup(groupId, agentId, { order: index }),
        ),
      );
      if (!isMutationContextCurrent(mutationContext)) return;

      await get().internal_refreshGroups();
    },

    toggleGroupSetting: (open) => {
      set({ showGroupSetting: open }, false, 'toggleGroupSetting');
    },

    toggleThread: (agentId) => {
      set({ activeThreadAgentId: agentId }, false, 'toggleThread');
    },

    updateGroup: async (id, value) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      await chatGroupService.updateGroup(id, value);
      if (!isMutationContextCurrent(mutationContext)) return;

      dispatch({ payload: { id, value }, type: 'updateGroup' });
      await get().internal_refreshGroups();
    },

    updateGroupConfig: async (config) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      const group = chatGroupSelectors.currentGroup(get());
      if (!group) return;
      const groupId = group.id;

      const mergedConfig = {
        ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        ...group.config,
        ...config,
      };

      await get().updateGroup(groupId, { config: mergedConfig });
      if (
        !isMutationContextCurrent(mutationContext) ||
        chatGroupSelectors.currentGroup(get())?.id !== groupId
      )
        return;

      // Also update the chat store's groupMaps to keep it in sync
      useChatStore.setState(
        produce((draft: ChatStoreState) => {
          const existing = draft.groupMaps[groupId];
          if (existing) {
            draft.groupMaps[groupId] = {
              ...existing,
              config: mergedConfig,
            } as ChatGroupItem;
          }
        }),
        false,
        n('updateGroupConfig/syncChatStore'),
      );
    },

    updateGroupMeta: async (meta) => {
      const mutationContext = captureMutationContext();
      if (!mutationContext) return;

      const group = chatGroupSelectors.currentGroup(get());
      if (!group) return;

      await get().updateGroup(group.id, meta);
    },

    useFetchGroupDetail: (enabled, groupId) => {
      const requestedScope = useUserStore(authSelectors.currentUserScope);
      const requestedGeneration = get().scopeGeneration;

      return useClientDataSWR<ChatGroupItem>(
        enabled && groupId && requestedScope
          ? [FETCH_GROUP_DETAIL_KEY, requestedScope, groupId]
          : null,
        async (cacheKey) => {
          const groupId = cacheKey[2] as string;
          const group = await chatGroupService.getGroup(groupId);
          if (!group) throw new Error(`Group ${groupId} not found`);
          return group;
        },
        {
          onSuccess: (group) => {
            if (
              authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
              get().scopeGeneration !== requestedGeneration
            )
              return;

            // Update groupMap with detailed group info
            const currentGroup = get().groupMap[group.id];
            if (isEqual(currentGroup, group)) return;

            const nextGroupMap = {
              ...get().groupMap,
              [group.id]: group,
            };

            set(
              {
                groupMap: nextGroupMap,
              },
              false,
              n('useFetchGroupDetail/onSuccess', { groupId: group.id }),
            );

            syncChatStoreGroupMap(nextGroupMap);
          },
        },
      );
    },

    // SWR Hooks for data fetching
    // This is not used for now, as we are combining group in the session lambda's response
    useFetchGroups: (enabled, isLogin) => {
      const requestedScope = useUserStore(authSelectors.currentUserScope);
      const requestedGeneration = get().scopeGeneration;

      return useClientDataSWR<ChatGroupItem[]>(
        enabled && isLogin !== undefined && requestedScope
          ? [FETCH_GROUPS_KEY, requestedScope]
          : null,
        async () => chatGroupService.getGroups(),
        {
          fallbackData: [],
          onSuccess: (groups) => {
            if (
              authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
              get().scopeGeneration !== requestedGeneration
            )
              return;

            // Update both groups list and groupMap
            const incomingMap = groups.reduce(
              (map, group) => {
                map[group.id] = group;
                return map;
              },
              {} as Record<string, ChatGroupItem>,
            );

            const currentMap = get().groupMap;
            const nextGroupMap = { ...currentMap, ...incomingMap };

            if (get().groupsInit && isEqual(currentMap, nextGroupMap)) {
              return;
            }

            set(
              {
                groupMap: nextGroupMap,
                groupsInit: true,
                isGroupsLoading: false,
              },
              false,
              n('useFetchGroups/onSuccess'),
            );

            syncChatStoreGroupMap(nextGroupMap);
          },
          suspense: true,
        },
      );
    },
  };
};
