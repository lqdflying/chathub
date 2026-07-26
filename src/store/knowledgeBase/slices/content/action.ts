import { StateCreator } from 'zustand/vanilla';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useFileStore } from '@/store/file';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export interface KnowledgeBaseContentAction {
  addFilesToKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<void>;
  removeFilesFromKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<void>;
}

export const createContentSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseContentAction
> = (_, get) => ({
  addFilesToKnowledgeBase: async (knowledgeBaseId, ids) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedFileGeneration = useFileStore.getState().scopeGeneration;
    if (!requestedScope) return;

    await knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, ids);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration ||
      useFileStore.getState().scopeGeneration !== requestedFileGeneration
    )
      return;

    await useFileStore.getState().refreshFileList();
  },

  removeFilesFromKnowledgeBase: async (knowledgeBaseId, ids) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedFileGeneration = useFileStore.getState().scopeGeneration;
    if (!requestedScope) return;

    await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration ||
      useFileStore.getState().scopeGeneration !== requestedFileGeneration
    )
      return;

    await useFileStore.getState().refreshFileList();
  },
});
