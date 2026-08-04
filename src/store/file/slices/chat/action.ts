import { isChunkableFile } from '@lobechat/utils';
import { t } from 'i18next';
import { StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { fileService } from '@/services/file';
import { ServerService } from '@/services/file/server';
import { ragService } from '@/services/rag';
import { UPLOAD_NETWORK_ERROR } from '@/services/upload';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import {
  UploadFileListDispatch,
  uploadFileListReducer,
} from '@/store/file/reducers/uploadFileList';
import { useUserStore } from '@/store/user';
import { FileListItem } from '@/types/files';
import { UploadFileItem } from '@/types/files/upload';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { FileStore } from '../../store';

const n = setNamespace('chat');

const serverFileService = new ServerService();

const captureFileMutationSnapshot = (state: FileStore) => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return;

  return {
    account,
    scopeGeneration: state.scopeGeneration,
  };
};

const isFileMutationCurrent = (
  state: FileStore,
  snapshot: NonNullable<ReturnType<typeof captureFileMutationSnapshot>>,
) =>
  isAccountMutationCurrent(useUserStore.getState(), snapshot.account) &&
  state.scopeGeneration === snapshot.scopeGeneration;

export interface FileAction {
  clearChatUploadFileList: () => void;
  dispatchChatUploadFileList: (payload: UploadFileListDispatch) => void;

  removeChatUploadFile: (id: string) => Promise<void>;
  startAsyncTask: (
    fileId: string,
    runner: (id: string) => Promise<string>,
    onFileItemChange: (fileItem: FileListItem) => void,
  ) => Promise<void>;

  uploadChatFiles: (files: File[]) => Promise<void>;
}

export const createFileSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileAction
> = (set, get) => ({
  clearChatUploadFileList: () => {
    set({ chatUploadFileList: [] }, false, n('clearChatUploadFileList'));
  },
  dispatchChatUploadFileList: (payload) => {
    const nextValue = uploadFileListReducer(get().chatUploadFileList, payload);
    if (nextValue === get().chatUploadFileList) return;

    set({ chatUploadFileList: nextValue }, false, `dispatchChatFileList/${payload.type}`);
  },
  removeChatUploadFile: async (id) => {
    const mutationSnapshot = captureFileMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const { dispatchChatUploadFileList } = get();

    if (!isFileMutationCurrent(get(), mutationSnapshot)) return;
    dispatchChatUploadFileList({ id, type: 'removeFile' });
    if (!isFileMutationCurrent(get(), mutationSnapshot)) return;

    await fileService.removeFile(id);
  },

  startAsyncTask: async (id, runner, onFileItemUpdate) => {
    const mutationSnapshot = captureFileMutationSnapshot(get());
    if (!mutationSnapshot) return;

    if (!isFileMutationCurrent(get(), mutationSnapshot)) return;
    await runner(id);
    if (!isFileMutationCurrent(get(), mutationSnapshot)) return;

    let isFinished = false;

    while (!isFinished) {
      // 每间隔 2s 查询一次任务状态
      await sleep(2000);
      if (!isFileMutationCurrent(get(), mutationSnapshot)) return;

      let fileItem: FileListItem | undefined = undefined;

      try {
        fileItem = await serverFileService.getFileItem(id);
      } catch (e) {
        if (!isFileMutationCurrent(get(), mutationSnapshot)) return;

        console.error('getFileItem Error:', e);
        continue;
      }

      if (!isFileMutationCurrent(get(), mutationSnapshot)) return;
      if (!fileItem) return;

      onFileItemUpdate(fileItem);

      if (fileItem.finishEmbedding) {
        isFinished = true;
      }

      // if error, also break
      else if (fileItem.chunkingStatus === 'error' || fileItem.embeddingStatus === 'error') {
        isFinished = true;
      }
    }
  },

  uploadChatFiles: async (rawFiles) => {
    const mutationSnapshot = captureFileMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const isOperationCurrent = () => isFileMutationCurrent(get(), mutationSnapshot);
    const accountInvalidationController = new AbortController();
    const unsubscribeFromAccountInvalidation = useUserStore.subscribe((state) => {
      if (!isAccountMutationCurrent(state, mutationSnapshot.account)) {
        accountInvalidationController.abort();
      }
    });
    const { dispatchChatUploadFileList } = get();
    // 0. skip file in blacklist
    const files = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    try {
      // 1. add files with base64
      const uploadFiles: UploadFileItem[] = await Promise.all(
        files.map(async (file) => {
          let previewUrl: string | undefined = undefined;
          let base64Url: string | undefined = undefined;

          // only image and video can be previewed, we create a previewUrl and base64Url for them
          if (file.type.startsWith('image') || file.type.startsWith('video')) {
            const data = await file.arrayBuffer();
            if (!isOperationCurrent()) {
              return { file, id: file.name, status: 'pending' } as UploadFileItem;
            }

            previewUrl = URL.createObjectURL(new Blob([data!], { type: file.type }));

            const base64 = Buffer.from(data!).toString('base64');
            base64Url = `data:${file.type};base64,${base64}`;
          }

          return {
            base64Url,
            file,
            id: file.name,
            previewUrl,
            status: 'pending',
          } as UploadFileItem;
        }),
      );

      if (!isOperationCurrent()) {
        uploadFiles.forEach((fileItem) => {
          if (fileItem?.previewUrl) URL.revokeObjectURL(fileItem.previewUrl);
        });
        return;
      }

      dispatchChatUploadFileList({ files: uploadFiles, type: 'addFiles' });

      // upload files and process it
      const pools = files.map(async (file) => {
        let fileResult: { id: string; url: string } | undefined;
        const isFileOperationCurrent = () =>
          isOperationCurrent() &&
          get().chatUploadFileList.some((fileItem) => fileItem.file === file);
        const dispatchFileStatusUpdate = (payload: UploadFileListDispatch) => {
          if (!isFileOperationCurrent()) return;

          dispatchChatUploadFileList(payload);
        };

        try {
          fileResult = await get().uploadWithProgress({
            file,
            onStatusUpdate: dispatchFileStatusUpdate,
            signal: accountInvalidationController.signal,
          });
        } catch (error) {
          if (!isFileOperationCurrent()) return;

          // skip `UNAUTHORIZED` error
          if ((error as any)?.message !== 'UNAUTHORIZED')
            notification.error({
              description:
                // it may be a network error or the cors error
                error === UPLOAD_NETWORK_ERROR
                  ? t('upload.networkError', { ns: 'error' })
                  : // or the error from the server
                    typeof error === 'string'
                    ? error
                    : t('upload.unknownError', { ns: 'error', reason: (error as Error).message }),
              message: t('upload.uploadFailed', { ns: 'error' }),
            });

          if (!isFileOperationCurrent()) return;
          dispatchChatUploadFileList({ id: file.name, type: 'removeFile' });
        }

        if (!isFileOperationCurrent()) return;
        if (!fileResult) return;

        // Screenshots and other non-document attachments remain in the topic,
        // but only loader-supported documents enter the chunking pipeline.
        if (!isChunkableFile(file.name, file.type)) return;

        if (!isFileOperationCurrent()) return;
        await ragService.parseFileContent(fileResult.id);
      });

      await Promise.all(pools);
    } finally {
      unsubscribeFromAccountInvalidation();
    }
  },
});
