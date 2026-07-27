import { StateCreator } from 'zustand/vanilla';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useFileStore } from '@/store/file';
import type { FileMutationCheckpoint } from '@/store/file/slices/upload/action';
import { KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { useUserStore } from '@/store/user';

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
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedKnowledgeBaseId = knowledgeBaseId;
    if (!accountMutationSnapshot || !requestedKnowledgeBaseId) return;

    const fileMutationCheckpoint: FileMutationCheckpoint = {
      accountMutationSnapshot,
      scopeGeneration: useFileStore.getState().scopeGeneration,
    };
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration &&
      useFileStore.getState().scopeGeneration === fileMutationCheckpoint.scopeGeneration;

    await knowledgeBaseService.addFilesToKnowledgeBase(requestedKnowledgeBaseId, ids);
    if (!isCurrentRequest()) return;

    await useFileStore.getState().refreshFileList(fileMutationCheckpoint);
  },

  removeFilesFromKnowledgeBase: async (knowledgeBaseId, ids) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    const requestedKnowledgeBaseId = knowledgeBaseId;
    if (!accountMutationSnapshot || !requestedKnowledgeBaseId) return;

    const fileMutationCheckpoint: FileMutationCheckpoint = {
      accountMutationSnapshot,
      scopeGeneration: useFileStore.getState().scopeGeneration,
    };
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration &&
      useFileStore.getState().scopeGeneration === fileMutationCheckpoint.scopeGeneration;

    await knowledgeBaseService.removeFilesFromKnowledgeBase(requestedKnowledgeBaseId, ids);
    if (!isCurrentRequest()) return;

    await useFileStore.getState().refreshFileList(fileMutationCheckpoint);
  },
});
