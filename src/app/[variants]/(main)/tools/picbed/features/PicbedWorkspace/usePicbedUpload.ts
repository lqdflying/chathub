import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PicbedUploadResult, picbedService } from '@/services/picbed';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const getFilesFromDataTransferItems = async (items: DataTransferItem[]): Promise<File[]> => {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && file.type.startsWith('image/')) files.push(file);
    }
  }
  return files;
};

export const usePicbedUpload = (requestedScope: string | undefined, onSuccess?: () => void) => {
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const activeUploadControllerRef = useRef<AbortController | undefined>(undefined);

  const uploadFiles = useCallback(
    async (files: File[]): Promise<PicbedUploadResult[] | undefined> => {
      if (!requestedScope || files.length === 0) return;

      activeUploadControllerRef.current?.abort();
      const abortController = new AbortController();
      activeUploadControllerRef.current = abortController;
      const assertCurrentUpload = () => {
        abortController.signal.throwIfAborted();
        if (authSelectors.currentUserScope(useUserStore.getState()) === requestedScope) return;

        abortController.abort();
        abortController.signal.throwIfAborted();
      };

      setUploading(true);
      const results: PicbedUploadResult[] = [];
      try {
        for (const file of files) {
          assertCurrentUpload();
          const result = await picbedService.uploadImage(
            file,
            requestedScope,
            abortController.signal,
          );
          assertCurrentUpload();
          results.push(result);
        }

        assertCurrentUpload();
        const urls = results.map((r) => r.url).join('\n');
        await navigator.clipboard.writeText(urls);
        assertCurrentUpload();
        message.success(t('picbed.uploadSuccessCopied'));
        onSuccess?.();
        return results;
      } catch (error) {
        if (
          abortController.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }

        message.error(t('picbed.uploadFailed'));
      } finally {
        if (activeUploadControllerRef.current === abortController) {
          activeUploadControllerRef.current = undefined;
          setUploading(false);
        }
      }
    },
    [message, onSuccess, requestedScope, t],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const files = await getFilesFromDataTransferItems(items);
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles],
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!e.dataTransfer?.items) return;
      const items = Array.from(e.dataTransfer.items);
      const files = await getFilesFromDataTransferItems(items);
      uploadFiles(files);
    },
    [uploadFiles],
  );

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDragEnter = () => setIsDragging(true);
    const handleDragLeave = () => setIsDragging(false);

    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      activeUploadControllerRef.current?.abort();
      activeUploadControllerRef.current = undefined;
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handlePaste, handleDrop]);

  return { isDragging, uploadFiles, uploading };
};
