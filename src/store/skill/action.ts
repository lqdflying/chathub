import { InstalledSkillItem, RemoteSkillSourceType } from '@lobechat/types';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { InstallSkillParams, UpdateSkillParams, skillService } from '@/services/skill';
import { useAgentStore } from '@/store/agent';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { SkillStore } from './store';

export interface SkillAction {
  clearSelectedSkills: (conversationKey?: string) => void;
  installSkill: (params: InstallSkillParams) => Promise<void>;
  installSkillFromUrl: (params: {
    authorization?: string;
    expectedIdentifier?: string;
    sourceRef?: string;
    sourceType: RemoteSkillSourceType;
    sourceUrl: string;
  }) => Promise<void>;
  refreshSkills: () => Promise<void>;
  toggleSelectedSkill: (identifier: string, enabled?: boolean, conversationKey?: string) => void;
  uninstallSkill: (identifier: string) => Promise<void>;
  updateSkill: (params: UpdateSkillParams) => Promise<void>;
  useFetchSkills: () => SWRResponse<InstalledSkillItem[]>;
}

export const createSkillSlice: StateCreator<
  SkillStore,
  [['zustand/devtools', never]],
  [],
  SkillAction
> = (set, get) => ({
  clearSelectedSkills: (conversationKey) => {
    if (!conversationKey) {
      set({ selectedSkillIdsByConversation: {} }, false, 'clearSelectedSkills/all');
      return;
    }

    const next = { ...get().selectedSkillIdsByConversation };
    delete next[conversationKey];
    set({ selectedSkillIdsByConversation: next }, false, 'clearSelectedSkills');
  },
  installSkill: async (params) => {
    await skillService.installSkill(params);
    await get().refreshSkills();
  },
  installSkillFromUrl: async (params) => {
    await skillService.installSkillFromUrl(params);
    await get().refreshSkills();
  },
  refreshSkills: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) {
      set(
        { installedSkills: [], isLoading: false, selectedSkillIdsByConversation: {} },
        false,
        'refreshSkills/noScope',
      );
      return;
    }

    await mutateAccountSWR(['installed-skills', requestedScope]);
  },
  toggleSelectedSkill: (identifier, enabled, conversationKey = 'global') => {
    const current = get().selectedSkillIdsByConversation[conversationKey] || [];
    const shouldEnable = enabled ?? !current.includes(identifier);
    const selected = shouldEnable
      ? [...new Set([...current, identifier])]
      : current.filter((id) => id !== identifier);
    const selectedSkillIdsByConversation = { ...get().selectedSkillIdsByConversation };
    if (selected.length > 0) selectedSkillIdsByConversation[conversationKey] = selected;
    else delete selectedSkillIdsByConversation[conversationKey];

    set(
      {
        selectedSkillIdsByConversation,
      },
      false,
      'toggleSelectedSkill',
    );
  },
  uninstallSkill: async (identifier) => {
    await skillService.uninstallSkill(identifier);

    const agentState = useAgentStore.getState();
    const agentMap = Object.fromEntries(
      Object.entries(agentState.agentMap).map(([id, config]) => {
        const skills = config.skills as string[] | undefined;
        return [
          id,
          skills?.includes(identifier)
            ? { ...config, skills: skills.filter((skillId) => skillId !== identifier) }
            : config,
        ];
      }),
    );
    const defaultSkills = agentState.defaultAgentConfig.skills;
    useAgentStore.setState({
      agentMap,
      defaultAgentConfig: defaultSkills?.includes(identifier)
        ? {
            ...agentState.defaultAgentConfig,
            skills: defaultSkills.filter((skillId) => skillId !== identifier),
          }
        : agentState.defaultAgentConfig,
    });

    const sessionState = useSessionStore.getState();
    const pruneSessions = (sessions: typeof sessionState.sessions) =>
      sessions.map((session) => {
        if (session.type !== 'group' || !session.members) return session;
        const hasSkill = session.members.some((member) => member.skills?.includes(identifier));
        if (!hasSkill) return session;

        return {
          ...session,
          members: session.members.map((member) =>
            member.skills?.includes(identifier)
              ? {
                  ...member,
                  skills: member.skills.filter((skillId) => skillId !== identifier),
                }
              : member,
          ),
        };
      });
    useSessionStore.setState({
      defaultSessions: pruneSessions(sessionState.defaultSessions),
      pinnedSessions: pruneSessions(sessionState.pinnedSessions),
      sessions: pruneSessions(sessionState.sessions),
    });

    await get().refreshSkills();
  },
  updateSkill: async (params) => {
    await skillService.updateSkill(params);
    await get().refreshSkills();
  },
  useFetchSkills: () => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);
    return useClientDataSWR<InstalledSkillItem[]>(
      requestedScope ? ['installed-skills', requestedScope] : null,
      skillService.getInstalledSkills,
      {
        fallbackData: [],
        onError: () => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
          set({ isLoading: false }, false, 'useFetchSkills/error');
        },
        onSuccess: (installedSkills) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
          const validIds = new Set(installedSkills.map(({ identifier }) => identifier));
          const selectedSkillIdsByConversation = Object.fromEntries(
            Object.entries(get().selectedSkillIdsByConversation)
              .map(([key, ids]) => [key, ids.filter((id) => validIds.has(id))])
              .filter(([, ids]) => ids.length > 0),
          );
          set(
            {
              installedSkills,
              isLoading: false,
              selectedSkillIdsByConversation,
            },
            false,
            'useFetchSkills/success',
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});
