import { InstalledSkillItem } from '@lobechat/types';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { InstallSkillParams, skillService } from '@/services/skill';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { SkillStore } from './store';

export interface SkillAction {
  clearSelectedSkills: () => void;
  installSkill: (params: InstallSkillParams) => Promise<void>;
  installSkillFromUrl: (params: {
    authorization?: string;
    sourceRef?: string;
    sourceType: 'github' | 'registry' | 'url';
    sourceUrl: string;
  }) => Promise<void>;
  refreshSkills: () => Promise<void>;
  toggleSelectedSkill: (identifier: string, enabled?: boolean) => void;
  uninstallSkill: (identifier: string) => Promise<void>;
  useFetchSkills: () => SWRResponse<InstalledSkillItem[]>;
}

export const createSkillSlice: StateCreator<
  SkillStore,
  [['zustand/devtools', never]],
  [],
  SkillAction
> = (set, get) => ({
  clearSelectedSkills: () => set({ selectedSkillIds: [] }, false, 'clearSelectedSkills'),
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
      set({ installedSkills: [], isLoading: false, selectedSkillIds: [] });
      return;
    }

    set({ isLoading: true }, false, 'refreshSkills/start');
    try {
      const installedSkills = await skillService.getInstalledSkills();
      if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
      const validIds = new Set(installedSkills.map(({ identifier }) => identifier));
      set(
        {
          installedSkills,
          selectedSkillIds: get().selectedSkillIds.filter((id) => validIds.has(id)),
        },
        false,
        'refreshSkills/success',
      );
    } finally {
      if (authSelectors.currentUserScope(useUserStore.getState()) === requestedScope) {
        set({ isLoading: false }, false, 'refreshSkills/end');
      }
    }
  },
  toggleSelectedSkill: (identifier, enabled) => {
    const current = get().selectedSkillIds;
    const shouldEnable = enabled ?? !current.includes(identifier);
    set(
      {
        selectedSkillIds: shouldEnable
          ? [...new Set([...current, identifier])]
          : current.filter((id) => id !== identifier),
      },
      false,
      'toggleSelectedSkill',
    );
  },
  uninstallSkill: async (identifier) => {
    await skillService.uninstallSkill(identifier);
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
          set(
            {
              installedSkills,
              isLoading: false,
              selectedSkillIds: get().selectedSkillIds.filter((id) => validIds.has(id)),
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
