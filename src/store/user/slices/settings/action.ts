import isEqual from 'fast-deep-equal';
import type { PartialDeep } from 'type-fest';
import type { StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { shareService } from '@/services/share';
import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import { captureUserMutationSnapshot, isUserMutationCurrent } from '@/store/user/userMutation';
import {
  createTrackedUserMutationController,
  releaseTrackedUserMutationController,
} from '@/store/user/userMutationController';
import { LobeAgentSettings } from '@/types/session';
import {
  SystemAgentItem,
  UserGeneralConfig,
  UserKeyVaults,
  UserSettings,
  UserSystemAgentConfigKey,
} from '@/types/user/settings';
import { difference } from '@/utils/difference';
import { merge } from '@/utils/merge';

const omitLegacyImageSetting = (settings: PartialDeep<UserSettings>) => {
  const { image: _image, ...activeSettings } = settings as PartialDeep<UserSettings> & {
    image?: unknown;
  };

  return activeSettings as PartialDeep<UserSettings>;
};

export interface UserSettingsAction {
  importAppSettings: (settings: UserSettings) => Promise<void>;
  importUrlShareSettings: (settingsParams: string | null) => Promise<void>;
  internal_createSignal: () => AbortController;
  resetSettings: () => Promise<void>;
  setSettings: (
    settings: PartialDeep<UserSettings>,
    options?: { skipRefresh?: boolean },
  ) => Promise<void>;
  updateDefaultAgent: (agent: PartialDeep<LobeAgentSettings>) => Promise<void>;
  updateGeneralConfig: (settings: Partial<UserGeneralConfig>) => Promise<void>;
  updateKeyVaults: (settings: Partial<UserKeyVaults>) => Promise<void>;

  updateSystemAgent: (
    key: UserSystemAgentConfigKey,
    value: Partial<SystemAgentItem>,
  ) => Promise<void>;
}

export const createSettingsSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  UserSettingsAction
> = (set, get) => ({
  importAppSettings: async (importAppSettings) => {
    const { setSettings } = get();

    await setSettings(importAppSettings);
  },

  /**
   * Import settings from a string in json format
   */
  importUrlShareSettings: async (settingsParams: string | null) => {
    if (settingsParams) {
      const importSettings = shareService.decodeShareSettings(settingsParams);
      if (importSettings?.message || !importSettings?.data) {
        // handle some error
        return;
      }

      await get().setSettings(importSettings.data);
    }
  },

  internal_createSignal: () => {
    const abortController = get().updateSettingsSignal;
    if (abortController && !abortController.signal.aborted)
      abortController.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = createTrackedUserMutationController(set, 'internal_createSignal');

    set({ updateSettingsSignal: newSignal }, false, 'signalForUpdateSettings');

    return newSignal;
  },

  resetSettings: async () => {
    const mutationSnapshot = captureUserMutationSnapshot(get());
    const abortController = createTrackedUserMutationController(set, 'resetSettings');

    try {
      await userService.resetUserSettings(abortController.signal);
      if (abortController.signal.aborted) return;
      if (!isUserMutationCurrent(get(), mutationSnapshot)) return;

      await get().refreshUserState();
    } finally {
      releaseTrackedUserMutationController(set, abortController, 'resetSettings');
    }
  },
  setSettings: async (settings, options) => {
    const mutationSnapshot = captureUserMutationSnapshot(get());
    const { settings: prevSetting, defaultSettings } = get();

    const nextSettings = merge(prevSetting, omitLegacyImageSetting(settings));

    if (isEqual(prevSetting, nextSettings)) return;

    const diffs = difference(nextSettings, defaultSettings);
    set({ settings: diffs }, false, 'optimistic_updateSettings');

    const abortController = get().internal_createSignal();
    try {
      await userService.updateUserSettings(diffs, abortController.signal);
      if (abortController.signal.aborted) return;
      if (!isUserMutationCurrent(get(), mutationSnapshot)) return;

      if (!options?.skipRefresh) await get().refreshUserState();
    } finally {
      releaseTrackedUserMutationController(set, abortController, 'setSettings');
      if (get().updateSettingsSignal === abortController) {
        set({ updateSettingsSignal: undefined }, false, 'setSettings/clearSignal');
      }
    }
  },
  updateDefaultAgent: async (defaultAgent) => {
    await get().setSettings({ defaultAgent });
  },
  updateGeneralConfig: async (general) => {
    await get().setSettings({ general });
  },
  updateKeyVaults: async (keyVaults) => {
    await get().setSettings({ keyVaults });
  },
  updateSystemAgent: async (key, value) => {
    await get().setSettings({
      systemAgent: { [key]: { ...value } },
    });
  },
});
