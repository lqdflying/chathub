import type { StateCreator } from 'zustand/vanilla';

import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import {
  captureUserMutationSnapshot,
  isUserMutationCurrent,
  type UserMutationSnapshot,
} from '@/store/user/userMutation';
import {
  createTrackedUserMutationController,
  releaseTrackedUserMutationController,
} from '@/store/user/userMutationController';
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
  const imageConfigUpdateQueues = new Map<string, Promise<unknown>>();

  const enqueueImageConfigUpdate = <Result>(
    mutationSnapshot: UserMutationSnapshot,
    persistImageConfig: (signal: AbortSignal) => Promise<Result>,
  ) => {
    const previousUpdate =
      imageConfigUpdateQueues.get(mutationSnapshot.scope) || Promise.resolve();
    const persistenceRequest = previousUpdate
      .catch(() => undefined)
      .then(async () => {
        if (!isUserMutationCurrent(get(), mutationSnapshot)) return;

        const abortController = createTrackedUserMutationController(
          set,
          'persistImageConfig',
        );
        try {
          const result = await persistImageConfig(abortController.signal);
          if (abortController.signal.aborted) return;

          return result;
        } finally {
          releaseTrackedUserMutationController(
            set,
            abortController,
            'persistImageConfig',
          );
        }
      });
    imageConfigUpdateQueues.set(mutationSnapshot.scope, persistenceRequest);
    persistenceRequest
      .finally(() => {
        if (imageConfigUpdateQueues.get(mutationSnapshot.scope) === persistenceRequest) {
          imageConfigUpdateQueues.delete(mutationSnapshot.scope);
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

    migrateImageConfigState: async (imageConfig) => {
      const mutationSnapshot = captureUserMutationSnapshot(get());
      return enqueueImageConfigUpdate(mutationSnapshot, (signal) =>
        userService.migrateImageConfig(imageConfig, signal),
      ).then((result) => {
        if (!result || !isUserMutationCurrent(get(), mutationSnapshot)) return;

        const currentPreference = get().preference;
        set(
          { preference: { ...currentPreference, imageConfig: result.imageConfig } },
          false,
          n('migrateImageConfigState'),
        );
      });
    },

    updateGuideState: async (guide) => {
      const { updatePreference } = get();
      const nextGuide = merge(get().preference.guide, guide);
      await updatePreference({ guide: nextGuide });
    },

    updateImageConfigState: async (imageConfig) => {
      const mutationSnapshot = captureUserMutationSnapshot(get());
      get().hydrateImageConfigState(imageConfig);
      const nextImageConfig = get().preference.imageConfig || {};

      return enqueueImageConfigUpdate(mutationSnapshot, (signal) =>
        userService.updateImageConfig(nextImageConfig, signal),
      ).then(() => undefined);
    },

    updatePreference: async (preference, action) => {
      const mutationSnapshot = captureUserMutationSnapshot(get());
      const nextPreference = merge(get().preference, preference);

      set({ preference: nextPreference }, false, action || n('updatePreference'));

      const abortController = createTrackedUserMutationController(
        set,
        'updatePreference',
      );
      try {
        await userService.updatePreference(preference, abortController.signal);
        if (abortController.signal.aborted) return;
        if (!isUserMutationCurrent(get(), mutationSnapshot)) return;
      } finally {
        releaseTrackedUserMutationController(
          set,
          abortController,
          'updatePreference',
        );
      }
    },
  };
};
