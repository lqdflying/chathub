import { t } from 'i18next';
import { sha256 } from 'js-sha256';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { LOBE_CHAT_CLOUD } from '@/const/branding';
import { fileService } from '@/services/file';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { FileMetadata, UploadFileItem } from '@/types/files';
import { getImageDimensions } from '@/utils/client/imageDimensions';

import { FileStore } from '../../store';

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
  onStatusUpdate?: OnStatusUpdate;
  signal?: AbortSignal;
  /**
   * Optional flag to indicate whether to skip the file type check.
   * When set to `true`, any file type checks will be bypassed.
   * Default is `false`, which means file type checks will be performed.
   */
  skipCheckFileType?: boolean;
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
      onStatusUpdate?: OnStatusUpdate;
    },
  ) => Promise<UploadWithProgressResult | undefined>;

  uploadWithProgress: (
    params: UploadWithProgressParams,
  ) => Promise<UploadWithProgressResult | undefined>;
}

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
  uploadBase64FileWithProgress: async (base64) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const abortController = new AbortController();
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

      const { metadata, fileType, size, hash } = await uploadService.uploadBase64ToS3(base64, {
        signal: abortController.signal,
      });
      abortController.signal.throwIfAborted();
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

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
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

      return { ...res, dimensions, filename: metadata.filename };
    } finally {
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
  },
  uploadWithProgress: async ({
    file,
    onStatusUpdate,
    knowledgeBaseId,
    signal,
    skipCheckFileType,
  }) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const abortController = new AbortController();
    const uploadSignal = signal
      ? AbortSignal.any([signal, abortController.signal])
      : abortController.signal;
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

      // 1. extract image dimensions if applicable
      const dimensions = await getImageDimensions(file);
      uploadSignal?.throwIfAborted();

      // 2. check file hash
      const hash = sha256(fileArrayBuffer);

      const checkStatus = await fileService.checkFileHash(hash, uploadSignal);
      uploadSignal?.throwIfAborted();
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;
      let metadata: FileMetadata;

      // 3. if file exist, just skip upload
      if (checkStatus.isExist) {
        metadata = checkStatus.metadata as FileMetadata;
        onStatusUpdate?.({
          id: file.name,
          type: 'updateFile',
          value: { status: 'processing', uploadState: { progress: 100, restTime: 0, speed: 0 } },
        });
      }
      // 3. if file don't exist, need upload files
      else {
        const { data, success } = await uploadService.uploadFileToS3(file, {
          onNotSupported: () => {
            onStatusUpdate?.({ id: file.name, type: 'removeFile' });
            message.info({
              content: t('upload.fileOnlySupportInServerMode', {
                cloud: LOBE_CHAT_CLOUD,
                ext: file.name.split('.').pop(),
                ns: 'error',
              }),
              duration: 5,
            });
          },
          onProgress: (status, upload) => {
            if (uploadSignal?.aborted) return;
            if (
              authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
              get().scopeGeneration !== requestedGeneration
            )
              return;

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
          skipCheckFileType,
        });
        if (!success) return;
        uploadSignal?.throwIfAborted();
        if (
          authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
          get().scopeGeneration !== requestedGeneration
        )
          return;

        metadata = data;
      }

      // 4. use more powerful file type detector to get file type
      let fileType = file.type;

      if (!file.type) {
        const { fileTypeFromBuffer } = await import('file-type');
        uploadSignal?.throwIfAborted();

        const type = await fileTypeFromBuffer(fileArrayBuffer);
        fileType = type?.mime || 'text/plain';
      }

      // 5. create file to db
      const data = await fileService.createFile(
        {
          fileType,
          hash,
          metadata,
          name: file.name,
          size: file.size,
          url: metadata.path || checkStatus.url,
        },
        knowledgeBaseId,
        uploadSignal,
      );
      uploadSignal?.throwIfAborted();
      if (
        authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
        get().scopeGeneration !== requestedGeneration
      )
        return;

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
  },
});
