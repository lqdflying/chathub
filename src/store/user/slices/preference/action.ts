import type { StateCreator } from 'zustand/vanilla';

import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import { UserGuide, UserImageGenerationConfig, UserPreference } from '@/types/user';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('preference');

export interface PreferenceAction {
  hydrateImageConfigState: (imageConfig: Partial<UserImageGenerationConfig>) => void;
  migrateImageConfigState: (imageConfig: Partial<UserImageGenerationConfig>) => Promise<void>;
  updateGuideState: (guide: Partial<UserGuide>) => Promise<void>;
  updateImageConfigState: (imageConfig: Partial<UserImageGenerationConfig>) => Promise<void>;
  updatePreference: (preference: Partial<UserPreference>, action?: any) => Promise<void>;
}

export const createPreferenceSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  PreferenceAction
> = (set, get) => {
  const imageConfigUpdateQueues = new Map<string | undefined, Promise<unknown>>();

  const enqueueImageConfigUpdate = <Result>(
    userId: string | undefined,
    persistImageConfig: () => Promise<Result>,
  ) => {
    const previousUpdate = imageConfigUpdateQueues.get(userId) || Promise.resolve();
    const persistenceRequest = previousUpdate
      .catch(() => undefined)
      .then(async () => {
        if (get().user?.id !== userId) return;
        return persistImageConfig();
      });
    imageConfigUpdateQueues.set(userId, persistenceRequest);
    persistenceRequest
      .finally(() => {
        if (imageConfigUpdateQueues.get(userId) === persistenceRequest) {
          imageConfigUpdateQueues.delete(userId);
        }
      })
      .catch(() => undefined);

    return persistenceRequest;
  };

  return {
    hydrateImageConfigState: (imageConfig) => {
      const currentPreference = get().preference;
      const nextImageConfig = merge(currentPreference.imageConfig || {}, imageConfig);

      set(
        { preference: { ...currentPreference, imageConfig: nextImageConfig } },
        false,
        n('hydrateImageConfigState'),
      );
    },

    migrateImageConfigState: (imageConfig) => {
      const userId = get().user?.id;
      return enqueueImageConfigUpdate(userId, () => userService.migrateImageConfig(imageConfig)).then(
        (result) => {
          if (!result || get().user?.id !== userId) return;

          const currentPreference = get().preference;
          set(
            { preference: { ...currentPreference, imageConfig: result.imageConfig } },
            false,
            n('migrateImageConfigState'),
          );
        },
      );
    },

    updateGuideState: async (guide) => {
      const { updatePreference } = get();
      const nextGuide = merge(get().preference.guide, guide);
      await updatePreference({ guide: nextGuide });
    },

    updateImageConfigState: (imageConfig) => {
      get().hydrateImageConfigState(imageConfig);
      const nextImageConfig = get().preference.imageConfig || {};
      const userId = get().user?.id;

      return enqueueImageConfigUpdate(userId, () =>
        userService.updateImageConfig(nextImageConfig),
      ).then(() => undefined);
    },

    updatePreference: async (preference, action) => {
      const nextPreference = merge(get().preference, preference);

      set({ preference: nextPreference }, false, action || n('updatePreference'));

      await userService.updatePreference(preference);
    },
  };
};
