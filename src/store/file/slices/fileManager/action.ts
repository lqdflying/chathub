import pMap from 'p-map';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { ServerService } from '@/services/file/server';
import { ragService } from '@/services/rag';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
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
import type { FileMutationCheckpoint } from '../upload/action';
import { fileManagerSelectors } from './selectors';

const serverFileService = new ServerService();
const activeDockUploadOperations = new Map<string, symbol>();
let nextDockUploadOperationId = 0;

interface LoadingOperationOwner {
  managesLoadingIndicator: boolean;
  tokens: Set<symbol>;
}

interface LoadingOperationOwnership {
  fileIds: string[];
  scopeKey: string;
  token: symbol;
}

type LoadingOperationRegistry = Map<string, Map<string, LoadingOperationOwner>>;

const activeEmbeddingOperations: LoadingOperationRegistry = new Map();
const activeParsingOperations: LoadingOperationRegistry = new Map();

const createDockUploadOperationId = (): string => {
  nextDockUploadOperationId += 1;

  return `dock-upload-${nextDockUploadOperationId}`;
};

const createLoadingOperationScopeKey = (checkpoint: FileMutationCheckpoint): string =>
  JSON.stringify([
    checkpoint.accountMutationSnapshot.scope,
    checkpoint.accountMutationSnapshot.ownershipInvalidationGeneration,
    checkpoint.scopeGeneration,
  ]);

const acquireLoadingOperation = (
  registry: LoadingOperationRegistry,
  fileIds: string[],
  checkpoint: FileMutationCheckpoint,
  currentlyLoadingIds: string[],
  toggleLoadingIds: (ids: string[]) => void,
): LoadingOperationOwnership => {
  const uniqueFileIds = Array.from(new Set(fileIds));
  const scopeKey = createLoadingOperationScopeKey(checkpoint);
  const token = Symbol(scopeKey);
  const scopeOwners = registry.get(scopeKey) ?? new Map<string, LoadingOperationOwner>();
  const fileIdsToEnable: string[] = [];

  registry.set(scopeKey, scopeOwners);

  for (const fileId of uniqueFileIds) {
    const existingOwner = scopeOwners.get(fileId);
    if (existingOwner) {
      existingOwner.tokens.add(token);
      continue;
    }

    const managesLoadingIndicator = !currentlyLoadingIds.includes(fileId);
    scopeOwners.set(fileId, {
      managesLoadingIndicator,
      tokens: new Set([token]),
    });

    if (managesLoadingIndicator) fileIdsToEnable.push(fileId);
  }

  if (fileIdsToEnable.length > 0) toggleLoadingIds(fileIdsToEnable);

  return { fileIds: uniqueFileIds, scopeKey, token };
};

const releaseLoadingOperation = (
  registry: LoadingOperationRegistry,
  ownership: LoadingOperationOwnership,
  canMutateLoadingState: boolean,
  toggleLoadingIds: (ids: string[], loading: false) => void,
): void => {
  const scopeOwners = registry.get(ownership.scopeKey);
  if (!scopeOwners) return;

  const fileIdsToDisable: string[] = [];

  for (const fileId of ownership.fileIds) {
    const owner = scopeOwners.get(fileId);
    if (!owner || !owner.tokens.delete(ownership.token) || owner.tokens.size > 0) continue;

    scopeOwners.delete(fileId);
    if (canMutateLoadingState && owner.managesLoadingIndicator) {
      fileIdsToDisable.push(fileId);
    }
  }

  if (scopeOwners.size === 0) registry.delete(ownership.scopeKey);
  if (fileIdsToDisable.length > 0) toggleLoadingIds(fileIdsToDisable, false);
};

const captureFileMutationCheckpoint = (
  scopeGeneration: number,
): FileMutationCheckpoint | undefined => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot) return;

  return { accountMutationSnapshot, scopeGeneration };
};

const isFileMutationCurrent = (
  checkpoint: FileMutationCheckpoint,
  scopeGeneration: number,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), checkpoint.accountMutationSnapshot) &&
  scopeGeneration === checkpoint.scopeGeneration;

export interface FileManageAction {
  dispatchDockFileList: (payload: UploadFileListDispatch) => void;
  embeddingChunks: (
    fileIds: string[],
    mutationCheckpoint?: FileMutationCheckpoint,
  ) => Promise<void>;
  parseFilesToChunks: (
    ids: string[],
    params?: { skipExist?: boolean },
    mutationCheckpoint?: FileMutationCheckpoint,
  ) => Promise<void>;
  pushDockFileList: (files: File[], knowledgeBaseId?: string) => Promise<void>;

  reEmbeddingChunks: (id: string) => Promise<void>;
  reParseFile: (id: string) => Promise<void>;
  refreshFileList: (mutationCheckpoint?: FileMutationCheckpoint) => Promise<void>;
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
  embeddingChunks: async (fileIds, requestedMutationCheckpoint) => {
    const mutationCheckpoint =
      requestedMutationCheckpoint ?? captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;

    const loadingOwnership = acquireLoadingOperation(
      activeEmbeddingOperations,
      fileIds,
      mutationCheckpoint,
      get().creatingEmbeddingTaskIds,
      (ids) => get().toggleEmbeddingIds(ids),
    );

    try {
      const pools = fileIds.map(async (id) => {
        if (!isOperationCurrent()) return;

        try {
          await ragService.createEmbeddingChunksTask(id);
          if (!isOperationCurrent()) return;
        } catch (e) {
          if (!isOperationCurrent()) return;

          console.error(e);
        }
      });

      await Promise.all(pools);
      if (!isOperationCurrent()) return;

      await get().refreshFileList(mutationCheckpoint);
      if (!isOperationCurrent()) return;
    } finally {
      releaseLoadingOperation(
        activeEmbeddingOperations,
        loadingOwnership,
        isOperationCurrent(),
        (ids, loading) => get().toggleEmbeddingIds(ids, loading),
      );
    }
  },
  parseFilesToChunks: async (ids, params, requestedMutationCheckpoint) => {
    const mutationCheckpoint =
      requestedMutationCheckpoint ?? captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;

    const loadingOwnership = acquireLoadingOperation(
      activeParsingOperations,
      ids,
      mutationCheckpoint,
      get().creatingChunkingTaskIds,
      (fileIds) => get().toggleParsingIds(fileIds),
    );

    try {
      const pools = ids.map(async (id) => {
        if (!isOperationCurrent()) return;

        try {
          await ragService.createParseFileTask(id, params?.skipExist);
          if (!isOperationCurrent()) return;
        } catch (e) {
          if (!isOperationCurrent()) return;

          console.error(e);
        }
      });

      await Promise.all(pools);
      if (!isOperationCurrent()) return;

      await get().refreshFileList(mutationCheckpoint);
      if (!isOperationCurrent()) return;
    } finally {
      releaseLoadingOperation(
        activeParsingOperations,
        loadingOwnership,
        isOperationCurrent(),
        (fileIds, loading) => get().toggleParsingIds(fileIds, loading),
      );
    }
  },
  pushDockFileList: async (rawFiles, knowledgeBaseId) => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;
    const { dispatchDockFileList } = get();

    // 0. Process ZIP files and extract their contents
    const filesToUpload: File[] = [];
    for (const file of rawFiles) {
      if (!isOperationCurrent()) return;

      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        try {
          if (!isOperationCurrent()) return;
          const extractedFiles = await unzipFile(file);
          if (!isOperationCurrent()) return;
          filesToUpload.push(...extractedFiles);
        } catch (error) {
          if (!isOperationCurrent()) return;

          console.error('Failed to extract ZIP file:', error);
          // If extraction fails, treat it as a regular file
          filesToUpload.push(file);
        }
      } else {
        filesToUpload.push(file);
      }
    }

    // 1. skip file in blacklist
    if (!isOperationCurrent()) return;
    const files = filesToUpload.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
    if (!isOperationCurrent()) return;

    const uploadOperations = files.map((file) => {
      const id = createDockUploadOperationId();
      const token = Symbol(id);
      activeDockUploadOperations.set(id, token);

      return { file, id, token };
    });

    // 2. Add all files to dock
    if (!isOperationCurrent()) return;
    dispatchDockFileList({
      atStart: true,
      files: uploadOperations.map(({ file, id }) => ({ file, id, status: 'pending' })),
      type: 'addFiles',
    });

    // 3. Upload files with concurrency limit using p-map
    const uploadResults = await pMap(
      uploadOperations,
      async ({ file, id, token }) => {
        const isUploadEntryCurrent = () =>
          isOperationCurrent() &&
          activeDockUploadOperations.get(id) === token;
        const dispatchUploadStatus: typeof dispatchDockFileList = (payload) => {
          if (!isUploadEntryCurrent()) return;

          if (payload.type === 'updateFile') {
            dispatchDockFileList({
              ...payload,
              id,
              value: { ...payload.value, id },
            });
            return;
          }

          dispatchDockFileList({ ...payload, id });
        };
        if (!isUploadEntryCurrent()) {
          return { file, fileId: undefined, fileType: file.type };
        }

        const result = await get().uploadWithProgress({
          file,
          knowledgeBaseId,
          mutationCheckpoint,
          onStatusUpdate: dispatchUploadStatus,
        });
        if (!isUploadEntryCurrent()) {
          return { file, fileId: undefined, fileType: file.type };
        }

        if (!isUploadEntryCurrent()) {
          return { file, fileId: undefined, fileType: file.type };
        }
        await get().refreshFileList(mutationCheckpoint);
        if (!isUploadEntryCurrent()) {
          return { file, fileId: undefined, fileType: file.type };
        }

        return { file, fileId: result?.id, fileType: file.type };
      },
      { concurrency: MAX_UPLOAD_FILE_COUNT },
    );
    for (const { id, token } of uploadOperations) {
      if (activeDockUploadOperations.get(id) === token) {
        activeDockUploadOperations.delete(id);
      }
    }
    if (!isOperationCurrent()) return;

    // 4. auto-embed files that support chunking
    const fileIdsToEmbed = uploadResults
      .filter(({ fileType, fileId }) => fileId && !isChunkingUnsupported(fileType))
      .map(({ fileId }) => fileId!);

    if (fileIdsToEmbed.length > 0) {
      if (!isOperationCurrent()) return;
      await get().parseFilesToChunks(fileIdsToEmbed, { skipExist: false }, mutationCheckpoint);
      if (!isOperationCurrent()) return;
    }
  },

  reEmbeddingChunks: async (id) => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;
    if (fileManagerSelectors.isCreatingChunkEmbeddingTask(id)(get())) return;

    const loadingOwnership = acquireLoadingOperation(
      activeEmbeddingOperations,
      [id],
      mutationCheckpoint,
      get().creatingEmbeddingTaskIds,
      (ids) => get().toggleEmbeddingIds(ids),
    );

    try {
      if (!isOperationCurrent()) return;
      await serverFileService.removeFileAsyncTask(id, 'embedding');
      if (!isOperationCurrent()) return;

      await get().refreshFileList(mutationCheckpoint);
      if (!isOperationCurrent()) return;

      await ragService.createEmbeddingChunksTask(id);
      if (!isOperationCurrent()) return;

      await get().refreshFileList(mutationCheckpoint);
      if (!isOperationCurrent()) return;
    } finally {
      releaseLoadingOperation(
        activeEmbeddingOperations,
        loadingOwnership,
        isOperationCurrent(),
        (ids, loading) => get().toggleEmbeddingIds(ids, loading),
      );
    }
  },
  reParseFile: async (id) => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;

    const loadingOwnership = acquireLoadingOperation(
      activeParsingOperations,
      [id],
      mutationCheckpoint,
      get().creatingChunkingTaskIds,
      (ids) => get().toggleParsingIds(ids),
    );

    try {
      if (!isOperationCurrent()) return;
      await ragService.retryParseFile(id);
      if (!isOperationCurrent()) return;

      await get().refreshFileList(mutationCheckpoint);
      if (!isOperationCurrent()) return;
    } finally {
      releaseLoadingOperation(
        activeParsingOperations,
        loadingOwnership,
        isOperationCurrent(),
        (ids, loading) => get().toggleParsingIds(ids, loading),
      );
    }
  },
  refreshFileList: async (requestedMutationCheckpoint) => {
    const mutationCheckpoint =
      requestedMutationCheckpoint ?? captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;
    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;

    await mutateAccountSWR([
      FETCH_FILE_LIST_KEY,
      mutationCheckpoint.accountMutationSnapshot.scope,
      get().queryListParams,
    ]);
  },
  removeAllFiles: async () => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;
    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;

    await fileService.removeAllFiles();
  },
  removeFileItem: async (id) => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;
    await fileService.removeFile(id);
    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;

    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;
    await get().refreshFileList(mutationCheckpoint);
  },

  removeFiles: async (ids) => {
    const mutationCheckpoint = captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;
    await fileService.removeFiles(ids);
    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;

    if (!isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration)) return;
    await get().refreshFileList(mutationCheckpoint);
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
    const ownershipInvalidationGeneration = useUserStore(
      (state) => state.ownershipInvalidationGeneration,
    );
    const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);
    const accountMutationSnapshot =
      requestedScope && !hasOwnerMismatch
        ? {
            ownershipInvalidationGeneration,
            scope: requestedScope,
          }
        : undefined;
    const requestedGeneration = get().scopeGeneration;
    const isRequestCurrent = () =>
      !!accountMutationSnapshot &&
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().scopeGeneration === requestedGeneration;

    return useClientDataSWR<FileListItem[]>(
      accountMutationSnapshot
        ? [FETCH_FILE_LIST_KEY, accountMutationSnapshot.scope, params]
        : null,
      () => serverFileService.getFiles(params),
      {
        onSuccess: (data) => {
          if (!isRequestCurrent()) return;

          set({ fileList: data, queryListParams: params });
        },
      },
    );
  },
});
