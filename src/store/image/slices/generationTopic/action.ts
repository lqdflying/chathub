import { chainSummaryGenerationTitle } from '@lobechat/prompts';
import isEqual from 'fast-deep-equal';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { LOADING_FLAT } from '@/const/message';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import { ImageGenerationTopic } from '@/types/generation';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { ImageStore } from '../../store';
import { GenerationTopicDispatch, generationTopicReducer } from './reducer';
import { generationTopicSelectors } from './selectors';

const FETCH_GENERATION_TOPICS_KEY = 'fetchGenerationTopics';

const n = setNamespace('generationTopic');

export interface GenerationTopicAction {
  createGenerationTopic: (prompts: string[]) => Promise<string>;
  removeGenerationTopic: (id: string) => Promise<void>;
  useFetchGenerationTopics: (enabled: boolean) => SWRResponse<ImageGenerationTopic[]>;
  summaryGenerationTopicTitle: (topicId: string, prompts: string[]) => Promise<string>;
  refreshGenerationTopics: () => Promise<void>;
  switchGenerationTopic: (topicId: string) => void;
  openNewGenerationTopic: () => void;
  updateGenerationTopicCover: (topicId: string, imageUrl: string) => Promise<void>;

  internal_updateGenerationTopicLoading: (id: string, loading: boolean) => void;
  internal_dispatchGenerationTopic: (payload: GenerationTopicDispatch, action?: any) => void;
  internal_createGenerationTopic: () => Promise<string>;
  internal_updateGenerationTopic: (id: string, data: UpdateTopicValue) => Promise<void>;
  internal_updateGenerationTopicTitleInSummary: (id: string, title: string) => void;
  internal_removeGenerationTopic: (id: string) => Promise<void>;
  internal_updateGenerationTopicCover: (topicId: string, coverUrl: string) => Promise<void>;
}

export const createGenerationTopicSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationTopicAction
> = (set, get) => ({
  createGenerationTopic: async (prompts: string[]) => {
    // Validate prompts - cannot be empty
    if (!prompts || prompts.length === 0) {
      throw new Error('Prompts cannot be empty when creating a generation topic');
    }

    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return '';

    const { internal_createGenerationTopic, summaryGenerationTopicTitle } = get();

    // Create topic with default title
    const topicId = await internal_createGenerationTopic();
    if (
      !topicId ||
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return '';

    // Auto-generate title from prompts
    summaryGenerationTopicTitle(topicId, prompts);

    return topicId;
  },

  switchGenerationTopic: (topicId: string) => {
    // Check if topic exists
    const currentTopics = get().generationTopics;
    const targetTopic = currentTopics.find((topic) => topic.id === topicId);

    if (!targetTopic) {
      console.warn(`Generation topic with id ${topicId} not found`);
      return;
    }

    // Don't update if already active
    if (get().activeGenerationTopicId === topicId) return;

    set({ activeGenerationTopicId: topicId }, false, n('switchGenerationTopic'));
  },

  openNewGenerationTopic: () => {
    set({ activeGenerationTopicId: null }, false, n('openNewGenerationTopic'));
  },

  summaryGenerationTopicTitle: async (topicId: string, prompts: string[]) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return '';
    const isCurrentRequest = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
      get().scopeGeneration === requestedGeneration;

    const topic = generationTopicSelectors.getGenerationTopicById(topicId)(get());
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    const { internal_updateGenerationTopicTitleInSummary, internal_updateGenerationTopicLoading } =
      get();

    internal_updateGenerationTopicLoading(topicId, true);
    internal_updateGenerationTopicTitleInSummary(topicId, LOADING_FLAT);

    let output = '';

    // Helper function to generate fallback title from prompts
    const generateFallbackTitle = () => {
      // Extract title from the first prompt content
      const title = prompts[0]
        .replaceAll(/[^\s\w\u4E00-\u9FFF]/g, '') // Remove punctuation, keep Chinese characters
        .trim()
        .split(/\s+/) // Split by whitespace
        .slice(0, 3) // Take first 3 words
        .join(' ')
        .slice(0, 10); // Limit to 10 characters

      return title;
    };

    const generationTopicAgentConfig = systemAgentSelectors.generationTopic(
      useUserStore.getState(),
    );
    // Auto generate topic title from prompt by AI
    await chatService.fetchPresetTaskResult({
      params: merge(
        generationTopicAgentConfig,
        chainSummaryGenerationTitle(prompts, 'image', globalHelpers.getCurrentLanguage()),
      ),
      onError: async () => {
        if (!isCurrentRequest()) return;

        const fallbackTitle = generateFallbackTitle();
        internal_updateGenerationTopicTitleInSummary(topicId, fallbackTitle);
        // Update the topic with fallback title
        await get().internal_updateGenerationTopic(topicId, { title: fallbackTitle });
      },
      onFinish: async (text) => {
        if (!isCurrentRequest()) return;

        await get().internal_updateGenerationTopic(topicId, { title: text });
      },
      onLoadingChange: (loading) => {
        if (!isCurrentRequest()) return;

        internal_updateGenerationTopicLoading(topicId, loading);
      },
      onMessageHandle: (chunk) => {
        if (!isCurrentRequest()) return;

        switch (chunk.type) {
          case 'text': {
            output += chunk.text;
            internal_updateGenerationTopicTitleInSummary(topicId, output);
          }
        }
      },
    });

    return output;
  },

  internal_createGenerationTopic: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return '';

    const tmpId = Date.now().toString();

    // 1. Optimistic update - add temporary topic
    get().internal_dispatchGenerationTopic(
      { type: 'addTopic', value: { id: tmpId, title: '' } },
      'internal_createGenerationTopic',
    );

    get().internal_updateGenerationTopicLoading(tmpId, true);

    // 2. Call backend service
    const topicId = await generationTopicService.createTopic();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return '';

    get().internal_updateGenerationTopicLoading(tmpId, false);

    // 3. Refresh data to ensure consistency
    get().internal_updateGenerationTopicLoading(topicId, true);
    await get().refreshGenerationTopics();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return '';

    get().internal_updateGenerationTopicLoading(topicId, false);

    return topicId;
  },

  internal_updateGenerationTopic: async (id, data) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    // 1. Optimistic update
    get().internal_dispatchGenerationTopic({ type: 'updateTopic', id, value: data });

    // 2. Update loading state
    get().internal_updateGenerationTopicLoading(id, true);

    // 3. Call backend service
    await generationTopicService.updateTopic(id, data);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // 4. Refresh data and clear loading
    await get().refreshGenerationTopics();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().internal_updateGenerationTopicLoading(id, false);
  },

  internal_updateGenerationTopicTitleInSummary: (id, title) => {
    get().internal_dispatchGenerationTopic(
      { type: 'updateTopic', id, value: { title } },
      'updateGenerationTopicTitleInSummary',
    );
  },

  internal_updateGenerationTopicLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { loadingGenerationTopicIds: [...state.loadingGenerationTopicIds, id] };

        return {
          loadingGenerationTopicIds: state.loadingGenerationTopicIds.filter((i) => i !== id),
        };
      },
      false,
      n('updateGenerationTopicLoading'),
    );
  },

  internal_dispatchGenerationTopic: (payload, action) => {
    const nextTopics = generationTopicReducer(get().generationTopics, payload);

    // No need to update if the topics are the same
    if (isEqual(nextTopics, get().generationTopics)) return;

    set(
      { generationTopics: nextTopics },
      false,
      action ?? n(`dispatchGenerationTopic/${payload.type}`),
    );
  },

  useFetchGenerationTopics: (enabled) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<ImageGenerationTopic[]>(
      enabled && requestedScope ? [FETCH_GENERATION_TOPICS_KEY, requestedScope] : null,
      () => generationTopicService.getAllGenerationTopics(),
      {
        suspense: true,
        onSuccess: (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          // No need to update if data is the same
          if (isEqual(data, get().generationTopics)) return;
          set({ generationTopics: data }, false, n('useFetchGenerationTopics'));
        },
      },
    );
  },

  refreshGenerationTopics: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutateAccountSWR([FETCH_GENERATION_TOPICS_KEY, requestedScope]);
  },

  removeGenerationTopic: async (id: string) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const {
      internal_removeGenerationTopic,
      generationTopics,
      activeGenerationTopicId,
      switchGenerationTopic,
      openNewGenerationTopic,
    } = get();

    const isRemovingActiveTopic = activeGenerationTopicId === id;
    let topicIndexToRemove = -1;

    if (isRemovingActiveTopic) {
      topicIndexToRemove = generationTopics.findIndex((topic) => topic.id === id);
    }

    await internal_removeGenerationTopic(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // if the active topic is the one being deleted, switch to the next topic
    if (isRemovingActiveTopic) {
      const newTopics = get().generationTopics;

      if (newTopics.length > 0) {
        // try to select the topic at the same index, if not, select the last one
        const newActiveIndex = Math.min(topicIndexToRemove, newTopics.length - 1);
        const newActiveTopic = newTopics[newActiveIndex];

        if (newActiveTopic) {
          switchGenerationTopic(newActiveTopic.id);
        } else {
          // fallback to open new topic, should not happen in this branch
          openNewGenerationTopic();
        }
      } else {
        // if no topics left, open a new one
        openNewGenerationTopic();
      }
    }
  },

  internal_removeGenerationTopic: async (id: string) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    get().internal_updateGenerationTopicLoading(id, true);
    try {
      await generationTopicService.deleteTopic(id);
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

      await get().refreshGenerationTopics();
    } finally {
      const isStaleRequest =
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration;
      if (!isStaleRequest) get().internal_updateGenerationTopicLoading(id, false);
    }
  },

  updateGenerationTopicCover: async (topicId: string, coverUrl: string) => {
    const { internal_updateGenerationTopicCover } = get();
    await internal_updateGenerationTopicCover(topicId, coverUrl);
  },

  internal_updateGenerationTopicCover: async (topicId: string, coverUrl: string) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const {
      internal_dispatchGenerationTopic,
      internal_updateGenerationTopicLoading,
      refreshGenerationTopics,
    } = get();

    // 1. Optimistic update - immediately show the new cover URL in UI
    internal_dispatchGenerationTopic(
      { type: 'updateTopic', id: topicId, value: { coverUrl } },
      'internal_updateGenerationTopicCover/optimistic',
    );

    // 2. Set loading state
    internal_updateGenerationTopicLoading(topicId, true);

    try {
      // 3. Call backend service to process and upload cover image
      await generationTopicService.updateTopicCover(topicId, coverUrl);
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

      // 4. Refresh data to get the final processed cover URL from S3
      await refreshGenerationTopics();
    } finally {
      const isStaleRequest =
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration;
      if (!isStaleRequest) {
        // 5. Clear loading state
        internal_updateGenerationTopicLoading(topicId, false);
      }
    }
  },
});
