import { StateCreator } from 'zustand';

import { imageService } from '@/services/image';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { ImageStore } from '../../store';
import { generationBatchSelectors } from '../generationBatch/selectors';
import { imageGenerationConfigSelectors } from '../generationConfig/selectors';
import { generationTopicSelectors } from '../generationTopic';

// ====== action interface ====== //

export interface CreateImageAction {
  createImage: () => Promise<void>;
  /**
   * eg: invalid api key, recreate image
   */
  recreateImage: (generationBatchId: string) => Promise<void>;
}

export class ImageRegenerationCleanupError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Replacement image generation was accepted, but failed outputs could not be removed');
    this.cause = cause;
    this.name = 'ImageRegenerationCleanupError';
  }
}

// ====== helper functions ====== //

const isRequestedScopeOwned = (requestedScope: string): boolean => {
  const userState = useUserStore.getState();

  return (
    authSelectors.currentUserScope(userState) === requestedScope &&
    !authSelectors.hasActiveUserStateOwnerMismatch(userState)
  );
};

// ====== action implementation ====== //

export const createCreateImageSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  CreateImageAction
> = (set, get) => ({
  async createImage() {
    const store = get();
    const userState = useUserStore.getState();
    const requestedScope = authSelectors.currentUserScope(userState);
    const requestedGeneration = store.scopeGeneration;
    const isOperationCurrent = () =>
      !!requestedScope &&
      isRequestedScopeOwned(requestedScope) &&
      get().scopeGeneration === requestedGeneration;

    if (!requestedScope) return;

    if (authSelectors.hasActiveUserStateOwnerMismatch(userState)) {
      throw new TypeError('user state ownership is not initialized');
    }

    if (!store.isInit || !store.isImageModelAvailable) {
      throw new TypeError('image configuration is not initialized');
    }

    const imageNum = imageGenerationConfigSelectors.imageNum(store);
    const parameters = imageGenerationConfigSelectors.parameters(store);
    const provider = imageGenerationConfigSelectors.provider(store);
    const model = imageGenerationConfigSelectors.model(store);
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    const { createGenerationTopic, switchGenerationTopic, setTopicBatchLoaded } = store;

    if (!parameters) {
      throw new TypeError('parameters is not initialized');
    }

    const prompt = parameters.prompt.trim();
    if (!prompt) {
      throw new TypeError('prompt is empty');
    }

    const abortController = new AbortController();
    set(
      (state) => ({
        imageGenerationAbortControllers: [
          ...state.imageGenerationAbortControllers,
          abortController,
        ],
        isCreating: true,
      }),
      false,
      'createImage/startCreateImage',
    );

    try {
      let generationTopicId = activeGenerationTopicId;

      if (!generationTopicId) {
        generationTopicId = await createGenerationTopic([prompt]);
        if (!isOperationCurrent()) return;

        setTopicBatchLoaded(generationTopicId);
        switchGenerationTopic(generationTopicId);
      }

      if (!isOperationCurrent()) return;

      await imageService.createImage(
        {
          generationTopicId,
          imageNum,
          model,
          params: { ...parameters, prompt } as any,
          provider,
        },
        abortController.signal,
      );

      if (!isOperationCurrent()) return;

      await get().refreshGenerationBatches(generationTopicId);
      if (!isOperationCurrent()) return;

      set(
        (state) =>
          state.parameters?.prompt === parameters.prompt
            ? { parameters: { ...state.parameters, prompt: '' } }
            : {},
        false,
        'createImage/clearPrompt',
      );
    } catch (error) {
      if (!isOperationCurrent()) return;

      throw error;
    } finally {
      if (isOperationCurrent()) {
        set(
          (state) => {
            const remainingAbortControllers = state.imageGenerationAbortControllers.filter(
              (controller) => controller !== abortController,
            );

            return {
              imageGenerationAbortControllers: remainingAbortControllers,
              isCreating: remainingAbortControllers.length > 0,
            };
          },
          false,
          'createImage/endCreateImage',
        );
      }
    }
  },

  async recreateImage(generationBatchId: string) {
    const store = get();
    if (store.regeneratingBatchIds.includes(generationBatchId)) return;

    const userState = useUserStore.getState();
    const requestedScope = authSelectors.currentUserScope(userState);
    const requestedGeneration = store.scopeGeneration;
    const isOperationCurrent = () =>
      !!requestedScope &&
      isRequestedScopeOwned(requestedScope) &&
      get().scopeGeneration === requestedGeneration;

    if (!requestedScope) return;

    if (authSelectors.hasActiveUserStateOwnerMismatch(userState)) {
      throw new TypeError('user state ownership is not initialized');
    }

    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    if (!activeGenerationTopicId) {
      throw new Error('No active generation topic');
    }

    const batch = generationBatchSelectors.getGenerationBatchByBatchId(generationBatchId)(store);
    if (!batch) {
      throw new Error('Generation batch not found');
    }

    const failedGenerations = batch.generations.filter(
      (generation) => generation.task.status === AsyncTaskStatus.Error,
    );
    if (failedGenerations.length === 0) return;

    const shouldRemoveWholeBatch = failedGenerations.length === batch.generations.length;
    const abortController = new AbortController();
    set(
      (state) => ({
        imageGenerationAbortControllers: [
          ...state.imageGenerationAbortControllers,
          abortController,
        ],
        isCreating: true,
        regeneratingBatchIds: [...state.regeneratingBatchIds, generationBatchId],
      }),
      false,
      'recreateImage/startCreateImage',
    );

    let operationError: unknown;
    let replacementAccepted = false;
    try {
      if (!isOperationCurrent()) return;

      await imageService.createImage(
        {
          generationTopicId: activeGenerationTopicId,
          imageNum: failedGenerations.length,
          model: batch.model,
          params: batch.config as any,
          provider: batch.provider,
          sourceGenerationBatchId: generationBatchId,
        },
        abortController.signal,
      );
      replacementAccepted = true;

      if (!isOperationCurrent()) return;

      if (shouldRemoveWholeBatch) {
        await get().removeGenerationBatch(generationBatchId, activeGenerationTopicId);
        if (!isOperationCurrent()) return;
      } else {
        for (const generation of failedGenerations) {
          await get().removeGeneration(generation.id);
          if (!isOperationCurrent()) return;
        }
      }
    } catch (error) {
      operationError = replacementAccepted ? new ImageRegenerationCleanupError(error) : error;
    }

    try {
      if (!isOperationCurrent()) return;

      await get().refreshGenerationBatches(activeGenerationTopicId);
      if (!isOperationCurrent()) return;
    } catch (error) {
      if (!operationError) {
        operationError = replacementAccepted ? new ImageRegenerationCleanupError(error) : error;
      } else {
        console.error('Failed to refresh generation batches after recreate:', error);
      }
    }

    if (isOperationCurrent()) {
      set(
        (state) => {
          const remainingAbortControllers = state.imageGenerationAbortControllers.filter(
            (controller) => controller !== abortController,
          );

          return {
            imageGenerationAbortControllers: remainingAbortControllers,
            isCreating: remainingAbortControllers.length > 0,
            regeneratingBatchIds: state.regeneratingBatchIds.filter(
              (batchId) => batchId !== generationBatchId,
            ),
          };
        },
        false,
        'recreateImage/endCreateImage',
      );
    }

    if (operationError && isOperationCurrent()) throw operationError;
  },
});
