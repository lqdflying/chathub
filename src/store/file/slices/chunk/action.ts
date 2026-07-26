import { StateCreator } from 'zustand/vanilla';

import { ragService } from '@/services/rag';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { FileStore } from '../../store';

export interface FileChunkAction {
  closeChunkDrawer: () => void;
  highlightChunks: (ids: string[]) => void;

  openChunkDrawer: (id: string) => void;
  semanticSearch: (text: string, fileId: string) => Promise<void>;
}

export const createFileChunkSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileChunkAction
> = (set, get) => ({
  closeChunkDrawer: () => {
    set({ chunkDetailId: null, isSimilaritySearch: false, similaritySearchChunks: [] });
  },
  highlightChunks: (ids) => {
    set({ highlightChunkIds: ids });
  },
  openChunkDrawer: (id) => {
    set({ chunkDetailId: id });
  },

  semanticSearch: async (text, fileId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    set({ isSimilaritySearching: true });
    const data = await ragService.semanticSearch(text, [fileId]);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    set({ isSimilaritySearching: false, similaritySearchChunks: data });
  },
});
