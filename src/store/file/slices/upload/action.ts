import { sha256 } from 'js-sha256';
import { StateCreator } from 'zustand/vanilla';

import { fileService } from '@/services/file';
import { uploadService } from '@/services/upload';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { useUserStore } from '@/store/user';
import { FileMetadata, UploadFileItem } from '@/types/files';
import { getImageDimensions } from '@/utils/client/imageDimensions';

import { FileStore } from '../../store';

export interface FileMutationCheckpoint {
  accountMutationSnapshot: AccountMutationSnapshot;
  scopeGeneration: number;
}

type OnStatusUpdate = (
  data:
    | {
        id: string;
        type: 'updateFile';
        value: Partial<UploadFileItem>;
      }
    | {
        id: string;
        type: 'removeFile';
      },
) => void;

interface UploadWithProgressParams {
  file: File;
  knowledgeBaseId?: string;
  knowledgeBaseUpload?: boolean;
  mutationCheckpoint?: FileMutationCheckpoint;
  onStatusUpdate?: OnStatusUpdate;
  signal?: AbortSignal;
}

interface UploadWithProgressResult {
  dimensions?: {
    height: number;
    width: number;
  };
  filename?: string;
  id: string;
  url: string;
}

export interface FileUploadAction {
  abortFileUploads: () => void;
  uploadBase64FileWithProgress: (
    base64: string,
    params?: {
      mutationCheckpoint?: FileMutationCheckpoint;
      onStatusUpdate?: OnStatusUpdate;
    },
  ) => Promise<UploadWithProgressResult | undefined>;

  uploadWithProgress: (
    params: UploadWithProgressParams,
  ) => Promise<UploadWithProgressResult | undefined>;
}

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

export const createFileUploadSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  FileUploadAction
> = (set, get) => ({
  abortFileUploads: () => {
    get().fileUploadAbortControllers.forEach((controller) => controller.abort());
    set({ fileUploadAbortControllers: [] }, false, 'abortFileUploads');
  },
  uploadBase64FileWithProgress: async (base64, params) => {
    const mutationCheckpoint =
      params?.mutationCheckpoint ?? captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;

    const abortController = new AbortController();
    if (!isOperationCurrent()) return;
    set(
      (state) => ({
        fileUploadAbortControllers: [...state.fileUploadAbortControllers, abortController],
      }),
      false,
      'uploadBase64FileWithProgress/addAbortController',
    );

    try {
      // Extract image dimensions from base64 data
      const dimensions = await getImageDimensions(base64);
      abortController.signal.throwIfAborted();
      if (!isOperationCurrent()) return;

      if (!isOperationCurrent()) return;
      const { metadata, fileType, size, hash } = await uploadService.uploadBase64ToS3(base64, {
        signal: abortController.signal,
      });
      abortController.signal.throwIfAborted();
      if (!isOperationCurrent()) return;

      if (!isOperationCurrent()) return;
      const res = await fileService.createFile(
        {
          fileType,
          hash,
          metadata,
          name: metadata.filename,
          size: size,
          url: metadata.path,
        },
        undefined,
        abortController.signal,
      );
      abortController.signal.throwIfAborted();
      if (!isOperationCurrent()) return;

      return { ...res, dimensions, filename: metadata.filename };
    } finally {
      if (isOperationCurrent()) {
        set(
          (state) => ({
            fileUploadAbortControllers: state.fileUploadAbortControllers.filter(
              (controller) => controller !== abortController,
            ),
          }),
          false,
          'uploadBase64FileWithProgress/removeAbortController',
        );
      }
    }
  },
  uploadWithProgress: async ({
    file,
    onStatusUpdate,
    knowledgeBaseId,
    knowledgeBaseUpload,
    mutationCheckpoint: requestedMutationCheckpoint,
    signal,
  }) => {
    const mutationCheckpoint =
      requestedMutationCheckpoint ?? captureFileMutationCheckpoint(get().scopeGeneration);
    if (!mutationCheckpoint) return;

    const isOperationCurrent = () =>
      isFileMutationCurrent(mutationCheckpoint, get().scopeGeneration);
    if (!isOperationCurrent()) return;

    const abortController = new AbortController();
    const uploadSignal = signal
      ? AbortSignal.any([signal, abortController.signal])
      : abortController.signal;
    if (!isOperationCurrent()) return;
    set(
      (state) => ({
        fileUploadAbortControllers: [...state.fileUploadAbortControllers, abortController],
      }),
      false,
      'uploadWithProgress/addAbortController',
    );

    try {
      const fileArrayBuffer = await file.arrayBuffer();
      uploadSignal?.throwIfAborted();
      if (!isOperationCurrent()) return;

      // 1. extract image dimensions if applicable
      if (!isOperationCurrent()) return;
      const dimensions = await getImageDimensions(file);
      uploadSignal?.throwIfAborted();
      if (!isOperationCurrent()) return;

      // 2. check file hash
      const hash = sha256(fileArrayBuffer);

      if (!isOperationCurrent()) return;
      const checkStatus = await fileService.checkFileHash(hash, uploadSignal);
      uploadSignal?.throwIfAborted();
      if (!isOperationCurrent()) return;
      let metadata: FileMetadata;

      // 3. if file exist, just skip upload
      if (checkStatus.isExist) {
        metadata = checkStatus.metadata as FileMetadata;
        if (!isOperationCurrent()) return;
        onStatusUpdate?.({
          id: file.name,
          type: 'updateFile',
          value: { status: 'processing', uploadState: { progress: 100, restTime: 0, speed: 0 } },
        });
      }
      // 3. if file don't exist, need upload files
      else {
        const { data, success } = await uploadService.uploadFileToS3(file, {
          onProgress: (status, upload) => {
            if (uploadSignal?.aborted) return;
            if (!isOperationCurrent()) return;

            onStatusUpdate?.({
              id: file.name,
              type: 'updateFile',
              value: {
                status: status === 'success' ? 'processing' : status,
                uploadState: upload,
              },
            });
          },
          signal: uploadSignal,
        });
        uploadSignal?.throwIfAborted();
        if (!isOperationCurrent()) return;
        if (!success) return;

        metadata = data;
      }

      // 4. use more powerful file type detector to get file type
      let fileType = file.type;

      if (!file.type) {
        if (!isOperationCurrent()) return;
        const { fileTypeFromBuffer } = await import('file-type');
        uploadSignal?.throwIfAborted();
        if (!isOperationCurrent()) return;

        if (!isOperationCurrent()) return;
        const type = await fileTypeFromBuffer(fileArrayBuffer);
        uploadSignal?.throwIfAborted();
        if (!isOperationCurrent()) return;
        fileType = type?.mime || 'text/plain';
      }

      // 5. create file to db
      if (!isOperationCurrent()) return;
      const data = await fileService.createFile(
        {
          fileType,
          hash,
          ...(knowledgeBaseUpload ? { knowledgeBaseUpload: true } : {}),
          metadata,
          name: file.name,
          size: file.size,
          url: metadata.path || checkStatus.url,
        },
        knowledgeBaseId,
        uploadSignal,
      );
      uploadSignal?.throwIfAborted();
      if (!isOperationCurrent()) return;

      if (!isOperationCurrent()) return;
      onStatusUpdate?.({
        id: file.name,
        type: 'updateFile',
        value: {
          fileUrl: data.url,
          id: data.id,
          status: 'success',
          uploadState: { progress: 100, restTime: 0, speed: 0 },
        },
      });

      return { ...data, dimensions, filename: file.name };
    } finally {
      if (isOperationCurrent()) {
        set(
          (state) => ({
            fileUploadAbortControllers: state.fileUploadAbortControllers.filter(
              (controller) => controller !== abortController,
            ),
          }),
          false,
          'uploadWithProgress/removeAbortController',
        );
      }
    }
  },
});
