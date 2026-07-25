import { StateCreator } from 'zustand';

import { imageService } from '@/services/image';

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

// ====== helper functions ====== //

// ====== action implementation ====== //

export const createCreateImageSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  CreateImageAction
> = (set, get) => ({
  async createImage() {
    const store = get();
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

    const isNewTopic = !activeGenerationTopicId;
    set(
      { isCreating: true, isCreatingWithNewTopic: isNewTopic },
      false,
      'createImage/startCreateImage',
    );

    try {
      let generationTopicId = activeGenerationTopicId;

      if (!generationTopicId) {
        generationTopicId = await createGenerationTopic([prompt]);
        setTopicBatchLoaded(generationTopicId);
        switchGenerationTopic(generationTopicId);
      }

      await imageService.createImage({
        generationTopicId,
        imageNum,
        model,
        params: { ...parameters, prompt } as any,
        provider,
      });

      if (!isNewTopic) {
        await get().refreshGenerationBatches();
      }

      set(
        (state) =>
          state.parameters?.prompt === parameters.prompt
            ? { parameters: { ...state.parameters, prompt: '' } }
            : {},
        false,
        'createImage/clearPrompt',
      );
    } finally {
      set(
        { isCreating: false, isCreatingWithNewTopic: false },
        false,
        'createImage/endCreateImage',
      );
    }
  },

  async recreateImage(generationBatchId: string) {
    const store = get();
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    if (!activeGenerationTopicId) {
      throw new Error('No active generation topic');
    }

    const batch = generationBatchSelectors.getGenerationBatchByBatchId(generationBatchId)(store);
    if (!batch) {
      throw new Error('Generation batch not found');
    }

    const imageNum = batch.generations.length;
    set({ isCreating: true }, false, 'recreateImage/startCreateImage');

    let operationError: unknown;
    try {
      await imageService.createImage({
        generationTopicId: activeGenerationTopicId,
        imageNum,
        model: batch.model,
        params: batch.config as any,
        provider: batch.provider,
      });

      // Only remove the failed batch after its replacement was accepted.
      await get().removeGenerationBatch(generationBatchId, activeGenerationTopicId);
    } catch (error) {
      operationError = error;
    }

    try {
      await get().refreshGenerationBatches();
    } catch (error) {
      if (!operationError) {
        operationError = error;
      } else {
        console.error('Failed to refresh generation batches after recreate:', error);
      }
    }

    set({ isCreating: false }, false, 'recreateImage/endCreateImage');

    if (operationError) throw operationError;
  },
});
