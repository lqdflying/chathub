import { DefaultErrorShape } from '@trpc/server/unstable-core-do-not-import';

import { lambdaClient } from '@/libs/trpc/client';
import { messageService } from '@/services/message';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';
import { ImportPgDataStructure } from '@/types/export';
import { ImportStage, OnImportCallbacks } from '@/types/importer';
import { uuid } from '@/utils/uuid';

import { IImportService } from './type';

const createImportErrorHandler =
  (callbacks?: OnImportCallbacks) =>
  (error: unknown): void => {
    callbacks?.onStageChange?.(ImportStage.Error);

    const errorShape = error as Partial<DefaultErrorShape>;
    const errorData = errorShape.data;

    callbacks?.onError?.({
      code: errorData?.code ?? 'ImportError',
      httpStatus: errorData?.httpStatus ?? 0,
      message: errorShape.message ?? String(error),
      ...(errorData?.path ? { path: errorData.path } : {}),
    });
  };

export class ServerService implements IImportService {
  importSettings: IImportService['importSettings'] = async (settings) => {
    await useUserStore.getState().importAppSettings(settings);
  };

  importData: IImportService['importData'] = async (data, callbacks) => {
    const handleError = createImportErrorHandler(callbacks);

    try {
      const expectedConversationVersion = await messageService.getConversationVersion();
      const totalLength =
        (data.messages?.length || 0) +
        (data.sessionGroups?.length || 0) +
        (data.sessions?.length || 0) +
        (data.topics?.length || 0);

      if (totalLength < 500) {
        callbacks?.onStageChange?.(ImportStage.Importing);
        const time = Date.now();
        const result = await lambdaClient.importer.importByPost.mutate({
          data,
          expectedConversationVersion,
        });
        const duration = Date.now() - time;

        callbacks?.onStageChange?.(ImportStage.Success);
        callbacks?.onSuccess?.(result.results, duration);

        return;
      }

      await this.uploadData(data, { callbacks, expectedConversationVersion });
    } catch (error) {
      handleError(error);
    }
  };

  importPgData: IImportService['importPgData'] = async (
    data: ImportPgDataStructure,
    {
      callbacks,
    }: {
      callbacks?: OnImportCallbacks;
      overwriteExisting?: boolean;
    } = {},
  ): Promise<void> => {
    const handleError = createImportErrorHandler(callbacks);

    try {
      const expectedConversationVersion = await messageService.getConversationVersion();
      const totalLength = Object.values(data.data)
        .map((dataItems) => dataItems.length)
        .reduce((total, itemCount) => total + itemCount, 0);

      if (totalLength < 500) {
        callbacks?.onStageChange?.(ImportStage.Importing);
        const time = Date.now();
        const result = await lambdaClient.importer.importPgByPost.mutate({
          ...data,
          expectedConversationVersion,
        });
        const duration = Date.now() - time;

        callbacks?.onStageChange?.(ImportStage.Success);
        callbacks?.onSuccess?.(result.results, duration);

        return;
      }

      await this.uploadData(data, { callbacks, expectedConversationVersion });
    } catch (error) {
      handleError(error);
    }
  };

  private uploadData = async (
    data: object,
    {
      callbacks,
      expectedConversationVersion,
    }: {
      callbacks?: OnImportCallbacks;
      expectedConversationVersion: number;
    },
  ) => {
    // if the data is too large, upload it to S3 and upload by file
    const filename = `${uuid()}.json`;

    let pathname;
    try {
      callbacks?.onStageChange?.(ImportStage.Uploading);
      const result = await uploadService.uploadDataToS3(data, {
        filename,
        onProgress: (status, state) => {
          callbacks?.onFileUploading?.(state);
        },
        pathname: `import_config/${filename}`,
      });
      pathname = result.data.path;
      console.log(pathname);
    } catch {
      throw new Error('Upload Error');
    }

    callbacks?.onStageChange?.(ImportStage.Importing);
    const time = Date.now();
    const result = await lambdaClient.importer.importByFile.mutate({
      expectedConversationVersion,
      pathname,
    });
    const duration = Date.now() - time;
    callbacks?.onStageChange?.(ImportStage.Success);
    callbacks?.onSuccess?.(result.results, duration);
  };
}
