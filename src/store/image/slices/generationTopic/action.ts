import { chainSummaryGenerationTitle } from '@lobechat/prompts';
import isEqual from 'fast-deep-equal';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { LOADING_FLAT } from '@/const/message';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors } from '@/store/user/selectors';
import {
  ImageGenerationTopic,
  ImageHistoryHousekeepingInput,
  ImageHistoryHousekeepingPreview,
  ImageHistoryHousekeepingResult,
} from '@/types/generation';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { ImageStore } from '../../store';
import { GenerationTopicDispatch, generationTopicReducer } from './reducer';
import { generationTopicSelectors } from './selectors';
import { normalizeGenerationTopicTitle } from './title';

const FETCH_GENERATION_TOPICS_KEY = 'fetchGenerationTopics';

const n = setNamespace('generationTopic');

interface GenerationTopicMutationContext {
  account: AccountMutationSnapshot;
  scopeGeneration: number;
}

type GenerationTopicMutationKind = 'cover' | 'create' | 'delete' | 'title' | 'update';

const activeTopicOperations = new Map<
  string,
  { operationIds: Set<symbol>; ownsLoadingMarker: boolean }
>();
const latestTopicOperations = new Map<string, symbol>();

const captureGenerationTopicMutationContext = (
  state: ImageStore,
): GenerationTopicMutationContext | undefined => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return;

  return { account, scopeGeneration: state.scopeGeneration };
};

const isGenerationTopicMutationCurrent = (
  state: ImageStore,
  context: GenerationTopicMutationContext,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), context.account) &&
  state.scopeGeneration === context.scopeGeneration;

const getTopicOperationKey = (
  context: GenerationTopicMutationContext,
  topicId: string,
  kind: GenerationTopicMutationKind,
) =>
  [
    context.account.scope,
    context.account.ownershipInvalidationGeneration,
    context.scopeGeneration,
    topicId,
    kind,
  ].join(':');

const getTopicLoadingKey = (context: GenerationTopicMutationContext, topicId: string) =>
  [
    context.account.scope,
    context.account.ownershipInvalidationGeneration,
    context.scopeGeneration,
    topicId,
  ].join(':');

const beginTopicOperation = (
  get: () => ImageStore,
  context: GenerationTopicMutationContext,
  topicId: string,
  kind: GenerationTopicMutationKind,
) => {
  const operationKey = getTopicOperationKey(context, topicId, kind);
  const loadingKey = getTopicLoadingKey(context, topicId);
  const operationId = Symbol(operationKey);
  const operationBucket = activeTopicOperations.get(loadingKey) ?? {
    operationIds: new Set<symbol>(),
    ownsLoadingMarker: !get().loadingGenerationTopicIds.includes(topicId),
  };

  operationBucket.operationIds.add(operationId);
  activeTopicOperations.set(loadingKey, operationBucket);
  latestTopicOperations.set(operationKey, operationId);
  if (operationBucket.ownsLoadingMarker && operationBucket.operationIds.size === 1) {
    get().internal_updateGenerationTopicLoading(topicId, true);
  }

  return { loadingKey, operationId, operationKey };
};

const isTopicOperationCurrent = (
  get: () => ImageStore,
  context: GenerationTopicMutationContext,
  operation: ReturnType<typeof beginTopicOperation>,
): boolean =>
  isGenerationTopicMutationCurrent(get(), context) &&
  latestTopicOperations.get(operation.operationKey) === operation.operationId;

const finishTopicOperation = (
  get: () => ImageStore,
  context: GenerationTopicMutationContext,
  topicId: string,
  operation: ReturnType<typeof beginTopicOperation>,
) => {
  const operationBucket = activeTopicOperations.get(operation.loadingKey);
  if (!operationBucket?.operationIds.delete(operation.operationId)) return;

  if (latestTopicOperations.get(operation.operationKey) === operation.operationId) {
    latestTopicOperations.delete(operation.operationKey);
  }

  if (operationBucket.operationIds.size > 0) return;
  activeTopicOperations.delete(operation.loadingKey);

  if (operationBucket.ownsLoadingMarker && isGenerationTopicMutationCurrent(get(), context)) {
    get().internal_updateGenerationTopicLoading(topicId, false);
  }
};

export interface GenerationTopicAction {
  createGenerationTopic: (prompts: string[]) => Promise<string>;
  housekeepGenerationTopics: (
    input: ImageHistoryHousekeepingInput,
  ) => Promise<ImageHistoryHousekeepingResult>;
  previewGenerationTopicHousekeeping: (
    input: ImageHistoryHousekeepingInput,
  ) => Promise<ImageHistoryHousekeepingPreview>;
  removeGenerationTopic: (id: string) => Promise<void>;
  useFetchGenerationTopics: (enabled: boolean) => SWRResponse<ImageGenerationTopic[]>;
  summaryGenerationTopicTitle: (
    topicId: string,
    prompts: string[],
    mutationContext?: GenerationTopicMutationContext,
  ) => Promise<string>;
  refreshGenerationTopics: (mutationContext?: GenerationTopicMutationContext) => Promise<void>;
  switchGenerationTopic: (topicId: string) => void;
  openNewGenerationTopic: () => void;
  updateGenerationTopicCover: (topicId: string, imageUrl: string) => Promise<void>;

  internal_updateGenerationTopicLoading: (id: string, loading: boolean) => void;
  internal_dispatchGenerationTopic: (payload: GenerationTopicDispatch, action?: any) => void;
  internal_createGenerationTopic: (
    mutationContext?: GenerationTopicMutationContext,
  ) => Promise<string>;
  internal_updateGenerationTopic: (
    id: string,
    data: UpdateTopicValue,
    mutationContext?: GenerationTopicMutationContext,
  ) => Promise<void>;
  internal_updateGenerationTopicTitleInSummary: (id: string, title: string) => void;
  internal_removeGenerationTopic: (
    id: string,
    mutationContext?: GenerationTopicMutationContext,
  ) => Promise<boolean>;
  internal_updateGenerationTopicCover: (
    topicId: string,
    coverUrl: string,
    mutationContext?: GenerationTopicMutationContext,
  ) => Promise<void>;
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

    const mutationContext = captureGenerationTopicMutationContext(get());
    if (!mutationContext) return '';
    const isCurrentRequest = () => isGenerationTopicMutationCurrent(get(), mutationContext);

    const { internal_createGenerationTopic, summaryGenerationTopicTitle } = get();

    // Create topic with default title
    const topicId = await internal_createGenerationTopic(mutationContext);
    if (!topicId || !isCurrentRequest()) return '';

    // Auto-generate title from prompts
    summaryGenerationTopicTitle(topicId, prompts, mutationContext);

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

  summaryGenerationTopicTitle: async (topicId, prompts, originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return '';

    const topic = generationTopicSelectors.getGenerationTopicById(topicId)(get());
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    const { internal_updateGenerationTopicTitleInSummary } = get();

    const operation = beginTopicOperation(get, mutationContext, topicId, 'title');
    const isCurrentRequest = () =>
      isTopicOperationCurrent(get, mutationContext, operation) &&
      generationTopicSelectors.getGenerationTopicById(topicId)(get()) !== undefined;

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
    try {
      await chatService.fetchPresetTaskResult({
        params: merge(
          generationTopicAgentConfig,
          chainSummaryGenerationTitle(prompts, 'image', globalHelpers.getCurrentLanguage()),
        ),
        onError: async () => {
          if (!isCurrentRequest()) return;

          const fallbackTitle = generateFallbackTitle();
          internal_updateGenerationTopicTitleInSummary(topicId, fallbackTitle);
          await get().internal_updateGenerationTopic(
            topicId,
            { title: fallbackTitle },
            mutationContext,
          );
        },
        onFinish: async (text) => {
          if (!isCurrentRequest()) return;

          const title = normalizeGenerationTopicTitle(text) || generateFallbackTitle();
          output = title;
          await get().internal_updateGenerationTopic(topicId, { title }, mutationContext);
        },
        onLoadingChange: () => {},
        onMessageHandle: (chunk) => {
          if (!isCurrentRequest()) return;

          switch (chunk.type) {
            case 'text': {
              output += chunk.text;
              internal_updateGenerationTopicTitleInSummary(
                topicId,
                normalizeGenerationTopicTitle(output),
              );
            }
          }
        },
      });
    } finally {
      finishTopicOperation(get, mutationContext, topicId, operation);
    }

    return output;
  },

  internal_createGenerationTopic: async (originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return '';

    const tmpId = Date.now().toString();
    const operation = beginTopicOperation(get, mutationContext, tmpId, 'create');
    const isCurrentRequest = () => isTopicOperationCurrent(get, mutationContext, operation);

    try {
      // 1. Optimistic update - add temporary topic
      get().internal_dispatchGenerationTopic(
        { type: 'addTopic', value: { id: tmpId, title: '' } },
        'internal_createGenerationTopic',
      );
      if (!isCurrentRequest()) return '';

      // 2. Call backend service
      const topicId = await generationTopicService.createTopic();
      if (!isCurrentRequest()) return '';

      // Topic-list SWR is not mounted until the mobile drawer opens. Promote the
      // optimistic row locally so activation and title generation do not depend on it.
      get().internal_dispatchGenerationTopic(
        { type: 'replaceTopic', id: tmpId, value: { id: topicId } },
        'internal_createGenerationTopic/promote',
      );
      if (!isCurrentRequest()) return '';

      finishTopicOperation(get, mutationContext, tmpId, operation);

      // 3. Refresh data to ensure consistency
      const refreshOperation = beginTopicOperation(get, mutationContext, topicId, 'create');
      try {
        await get().refreshGenerationTopics(mutationContext);
        if (!isTopicOperationCurrent(get, mutationContext, refreshOperation)) return '';

        return topicId;
      } finally {
        finishTopicOperation(get, mutationContext, topicId, refreshOperation);
      }
    } finally {
      finishTopicOperation(get, mutationContext, tmpId, operation);
    }
  },

  internal_updateGenerationTopic: async (id, data, originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return;
    const operation = beginTopicOperation(get, mutationContext, id, 'update');
    const isCurrentRequest = () => isTopicOperationCurrent(get, mutationContext, operation);

    try {
      // 1. Optimistic update
      get().internal_dispatchGenerationTopic({ type: 'updateTopic', id, value: data });
      if (!isCurrentRequest()) return;

      // 2. Call backend service
      await generationTopicService.updateTopic(id, data);
      if (!isCurrentRequest()) return;

      // 3. Refresh data
      await get().refreshGenerationTopics(mutationContext);
      if (!isCurrentRequest()) return;
    } finally {
      finishTopicOperation(get, mutationContext, id, operation);
    }
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

          const normalizedData = data.map((topic) => {
            if (!topic.title) return topic;

            const title = normalizeGenerationTopicTitle(topic.title);
            return title === topic.title ? topic : { ...topic, title };
          });

          // No need to update if data is the same
          if (isEqual(normalizedData, get().generationTopics)) return;
          set({ generationTopics: normalizedData }, false, n('useFetchGenerationTopics'));
        },
      },
    );
  },

  refreshGenerationTopics: async (originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return;

    await mutateAccountSWR([FETCH_GENERATION_TOPICS_KEY, mutationContext.account.scope]);
    if (!isGenerationTopicMutationCurrent(get(), mutationContext)) return;
  },

  previewGenerationTopicHousekeeping: async (input) => {
    const mutationContext = captureGenerationTopicMutationContext(get());
    if (!mutationContext) throw new Error('Image history ownership is not initialized');

    const result = await generationTopicService.previewHousekeeping(input);
    if (!isGenerationTopicMutationCurrent(get(), mutationContext)) {
      throw new DOMException('Image history account changed', 'AbortError');
    }

    return result;
  },

  housekeepGenerationTopics: async (input) => {
    const mutationContext = captureGenerationTopicMutationContext(get());
    if (!mutationContext) throw new Error('Image history ownership is not initialized');
    const activeTopicId = get().activeGenerationTopicId;

    const result = await generationTopicService.housekeep(input);
    if (!isGenerationTopicMutationCurrent(get(), mutationContext)) return result;

    await get().refreshGenerationTopics(mutationContext);
    if (!isGenerationTopicMutationCurrent(get(), mutationContext)) return result;

    if (activeTopicId && result.deletedTopicIds.includes(activeTopicId)) {
      const nextTopic = get().generationTopics[0];
      if (nextTopic) get().switchGenerationTopic(nextTopic.id);
      else get().openNewGenerationTopic();
    }

    return result;
  },

  removeGenerationTopic: async (id: string) => {
    const mutationContext = captureGenerationTopicMutationContext(get());
    if (!mutationContext) return;
    const isCurrentRequest = () => isGenerationTopicMutationCurrent(get(), mutationContext);

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

    const wasRemoved = await internal_removeGenerationTopic(id, mutationContext);
    if (!wasRemoved || !isCurrentRequest()) return;

    // if the active topic is the one being deleted, switch to the next topic
    if (isRemovingActiveTopic) {
      if (get().activeGenerationTopicId !== id) return;

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

  internal_removeGenerationTopic: async (id, originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return false;
    const operation = beginTopicOperation(get, mutationContext, id, 'delete');
    const isCurrentRequest = () => isTopicOperationCurrent(get, mutationContext, operation);

    try {
      if (!isCurrentRequest()) return false;
      await generationTopicService.deleteTopic(id);
      if (!isCurrentRequest()) return false;

      await get().refreshGenerationTopics(mutationContext);
      return isCurrentRequest();
    } finally {
      finishTopicOperation(get, mutationContext, id, operation);
    }
  },

  updateGenerationTopicCover: async (topicId: string, coverUrl: string) => {
    const mutationContext = captureGenerationTopicMutationContext(get());
    if (!mutationContext) return;

    const { internal_updateGenerationTopicCover } = get();
    await internal_updateGenerationTopicCover(topicId, coverUrl, mutationContext);
  },

  internal_updateGenerationTopicCover: async (topicId, coverUrl, originatingContext) => {
    const mutationContext = originatingContext ?? captureGenerationTopicMutationContext(get());
    if (!mutationContext || !isGenerationTopicMutationCurrent(get(), mutationContext)) return;

    const { internal_dispatchGenerationTopic, refreshGenerationTopics } = get();
    const operation = beginTopicOperation(get, mutationContext, topicId, 'cover');
    const isCurrentRequest = () => isTopicOperationCurrent(get, mutationContext, operation);

    // 1. Optimistic update - immediately show the new cover URL in UI
    internal_dispatchGenerationTopic(
      { type: 'updateTopic', id: topicId, value: { coverUrl } },
      'internal_updateGenerationTopicCover/optimistic',
    );
    if (!isCurrentRequest()) {
      finishTopicOperation(get, mutationContext, topicId, operation);
      return;
    }

    try {
      // 2. Call backend service to process and upload cover image
      await generationTopicService.updateTopicCover(topicId, coverUrl);
      if (!isCurrentRequest()) return;

      // 3. Refresh data to get the final processed cover URL from S3
      await refreshGenerationTopics(mutationContext);
    } finally {
      finishTopicOperation(get, mutationContext, topicId, operation);
    }
  },
});
