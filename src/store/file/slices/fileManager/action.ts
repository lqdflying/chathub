import pMap from 'p-map';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { ServerService } from '@/services/file/server';
import { ragService } from '@/services/rag';
import {
  UploadFileListDispatch,
  uploadFileListReducer,
} from '@/store/file/reducers/uploadFileList';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { FileListItem, QueryFileListParams } from '@/types/files';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { unzipFile } from '@/utils/unzipFile';

import { FileStore } from '../../store';
import { fileManagerSelectors } from './selectors';

const serverFileService = new ServerService();

export interface FileManageAction {
  dispatchDockFileList: (payload: UploadFileListDispatch) => void;
  embeddingChunks: (fileIds: string[]) => Promise<void>;
  parseFilesToChunks: (ids: string[], params?: { skipExist?: boolean }) => Promise<void>;
  pushDockFileList: (files: File[], knowledgeBaseId?: string) => Promise<void>;

  reEmbeddingChunks: (id: string) => Promise<void>;
  reParseFile: (id: string) => Promise<void>;
  refreshFileList: () => Promise<void>;
  removeAllFiles: () => Promise<void>;
  removeFileItem: (id: string) => Promise<void>;
  removeFiles: (ids: string[]) => Promise<void>;

  toggleEmbeddingIds: (ids: string[], loading?: boolean) => void;
  toggleParsingIds: (ids: string[], loading?: boolean) => void;

  useFetchFileItem: (id?: string) => SWRResponse<FileListItem | undefined>;
  useFetchFileManage: (params: QueryFileListParams) => SWRResponse<FileListItem[]>;
}

const FETCH_FILE_LIST_KEY = 'useFetchFileManage';

export const createFileManageSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileManageAction
> = (set, get) => ({
  dispatchDockFileList: (payload: UploadFileListDispatch) => {
    const nextValue = uploadFileListReducer(get().dockUploadFileList, payload);
    if (nextValue === get().dockUploadFileList) return;

    set({ dockUploadFileList: nextValue }, false, `dispatchDockFileList/${payload.type}`);
  },
  embeddingChunks: async (fileIds: string[]) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    // toggle file ids
    get().toggleEmbeddingIds(fileIds);

    // parse files
    const pools = fileIds.map(async (id) => {
      try {
        await ragService.createEmbeddingChunksTask(id);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().toggleEmbeddingIds(fileIds, false);
  },
  parseFilesToChunks: async (ids: string[], params) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    // toggle file ids
    get().toggleParsingIds(ids);

    // parse files
    const pools = ids.map(async (id) => {
      try {
        await ragService.createParseFileTask(id, params?.skipExist);
      } catch (e) {
        console.error(e);
      }
    });

    await Promise.all(pools);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().toggleParsingIds(ids, false);
  },
  pushDockFileList: async (rawFiles, knowledgeBaseId) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const { dispatchDockFileList } = get();

    // 0. Process ZIP files and extract their contents
    const filesToUpload: File[] = [];
    for (const file of rawFiles) {
      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        try {
          const extractedFiles = await unzipFile(file);
          if (
            authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
            get().scopeGeneration !== requestedGeneration
          )
            return;
          filesToUpload.push(...extractedFiles);
        } catch (error) {
          console.error('Failed to extract ZIP file:', error);
          // If extraction fails, treat it as a regular file
          filesToUpload.push(file);
        }
      } else {
        filesToUpload.push(file);
      }
    }

    // 1. skip file in blacklist
    const files = filesToUpload.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // 2. Add all files to dock
    dispatchDockFileList({
      atStart: true,
      files: files.map((file) => ({ file, id: file.name, status: 'pending' })),
      type: 'addFiles',
    });

    // 3. Upload files with concurrency limit using p-map
    const uploadResults = await pMap(
      files,
      async (file) => {
        const result = await get().uploadWithProgress({
          file,
          knowledgeBaseId,
          onStatusUpdate: dispatchDockFileList,
        });
        if (
          authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
          get().scopeGeneration !== requestedGeneration
        ) {
          return { file, fileId: undefined, fileType: file.type };
        }

        await get().refreshFileList();
        if (
          authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
          get().scopeGeneration !== requestedGeneration
        ) {
          return { file, fileId: undefined, fileType: file.type };
        }

        return { file, fileId: result?.id, fileType: file.type };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    );
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // 4. auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      await get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false });
    }
  },

  reEmbeddingChunks: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;
    if (fileManagerSelectors.isCreatingChunkEmbeddingTask(id)(get())) return;

    // toggle file ids
    get().toggleEmbeddingIds([id]);

    await serverFileService.removeFileAsyncTask(id, 'embedding');
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await ragService.createEmbeddingChunksTask(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().toggleEmbeddingIds([id], false);
  },
  reParseFile: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    // toggle file ids
    get().toggleParsingIds([id]);

    await ragService.retryParseFile(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    get().toggleParsingIds([id], false);
  },
  refreshFileList: async () => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    if (!requestedScope) return;

    await mutate([FETCH_FILE_LIST_KEY, requestedScope, get().queryListParams]);
  },
  removeAllFiles: async () => {
    await fileService.removeAllFiles();
  },
  removeFileItem: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await fileService.removeFile(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
  },

  removeFiles: async (ids) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await fileService.removeFiles(ids);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshFileList();
  },
  toggleEmbeddingIds: (ids, loading) => {
    set((state) => {
      const nextValue = new Set(state.creatingEmbeddingTaskIds);

      ids.forEach((id) => {
        if (typeof loading === 'undefined') {
          if (nextValue.has(id)) nextValue.delete(id);
          else nextValue.add(id);
        } else {
          if (loading) nextValue.add(id);
          else nextValue.delete(id);
        }
      });

      return { creatingEmbeddingTaskIds: Array.from(nextValue.values()) };
    });
  },
  toggleParsingIds: (ids, loading) => {
    set((state) => {
      const nextValue = new Set(state.creatingChunkingTaskIds);

      ids.forEach((id) => {
        if (typeof loading === 'undefined') {
          if (nextValue.has(id)) nextValue.delete(id);
          else nextValue.add(id);
        } else {
          if (loading) nextValue.add(id);
          else nextValue.delete(id);
        }
      });

      return { creatingChunkingTaskIds: Array.from(nextValue.values()) };
    });
  },

  useFetchFileItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<FileListItem | undefined>(
      !id || !requestedScope ? null : ['useFetchFileItem', requestedScope, id],
      () => serverFileService.getFileItem(id!),
    );
  },

  useFetchFileManage: (params) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<FileListItem[]>(
      requestedScope ? [FETCH_FILE_LIST_KEY, requestedScope, params] : null,
      () => serverFileService.getFiles(params),
      {
        onSuccess: (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          set({ fileList: data, queryListParams: params });
        },
      },
    );
  },
});
