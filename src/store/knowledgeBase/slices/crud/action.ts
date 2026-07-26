import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

const FETCH_KNOWLEDGE_BASE_LIST_KEY = 'FETCH_KNOWLEDGE_BASE';
const FETCH_KNOWLEDGE_BASE_ITEM_KEY = 'FETCH_KNOWLEDGE_BASE_ITEM';

export interface KnowledgeBaseCrudAction {
  createNewKnowledgeBase: (params: CreateKnowledgeBaseParams) => Promise<string>;
  internal_toggleKnowledgeBaseLoading: (id: string, loading: boolean) => void;
  refreshKnowledgeBaseList: () => Promise<void>;

  removeKnowledgeBase: (id: string) => Promise<void>;
  updateKnowledgeBase: (id: string, value: CreateKnowledgeBaseParams) => Promise<void>;

  useFetchKnowledgeBaseItem: (id: string) => SWRResponse<KnowledgeBaseItem | undefined>;
  useFetchKnowledgeBaseList: (params?: { suspense?: boolean }) => SWRResponse<KnowledgeBaseItem[]>;
}

export const createCrudSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseCrudAction
> = (set, get) => ({
  createNewKnowledgeBase: async (params) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return '';

    const id = await knowledgeBaseService.createKnowledgeBase(params);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return '';

    await get().refreshKnowledgeBaseList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return '';

    return id;
  },
  internal_toggleKnowledgeBaseLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  },
  refreshKnowledgeBaseList: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutate([FETCH_KNOWLEDGE_BASE_LIST_KEY, requestedScope]);
  },
  removeKnowledgeBase: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await knowledgeBaseService.deleteKnowledgeBase(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshKnowledgeBaseList();
  },
  updateKnowledgeBase: async (id, value) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    get().internal_toggleKnowledgeBaseLoading(id, true);
    await knowledgeBaseService.updateKnowledgeBaseList(id, value);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshKnowledgeBaseList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().internal_toggleKnowledgeBaseLoading(id, false);
  },

  useFetchKnowledgeBaseItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<KnowledgeBaseItem | undefined>(
      requestedScope ? [FETCH_KNOWLEDGE_BASE_ITEM_KEY, requestedScope, id] : null,
      () => knowledgeBaseService.getKnowledgeBaseById(id),
      {
        onSuccess: (item) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;
          if (!item) return;

          set({
            activeKnowledgeBaseId: id,
            activeKnowledgeBaseItems: {
              ...get().activeKnowledgeBaseItems,
              [id]: item,
            },
          });
        },
      },
    );
  },

  useFetchKnowledgeBaseList: (params = {}) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<KnowledgeBaseItem[]>(
      requestedScope ? [FETCH_KNOWLEDGE_BASE_LIST_KEY, requestedScope] : null,
      () => knowledgeBaseService.getKnowledgeBaseList(),
      {
        fallbackData: [],
        onSuccess: () => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          if (!get().initKnowledgeBaseList)
            set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
        suspense: params.suspense,
      },
    );
  },
});
