import { messageService } from '@/services/message';
import { createHeaderWithAuth } from '@/services/_auth';
import { useUserStore } from '@/store/user';
import { DataImportStrategy, ImportPgDataStructure } from '@/types/export';
import {
  ErrorShape,
  FileUploadState,
  ImportStage,
  OnImportCallbacks,
} from '@/types/importer';

import { IImportService } from './type';

class ImportRequestError extends Error {
  readonly shape: ErrorShape;

  constructor(shape: ErrorShape) {
    super(shape.message);
    this.name = 'ImportRequestError';
    this.shape = shape;
  }
}

const createImportErrorHandler =
  (callbacks?: OnImportCallbacks) =>
  (error: unknown): void => {
    callbacks?.onStageChange?.(ImportStage.Error);

    const shape =
      error instanceof ImportRequestError
        ? error.shape
        : {
            code: 'ImportError',
            httpStatus: 0,
            message: error instanceof Error ? error.message : String(error),
          };

    callbacks?.onError?.(shape);
  };

const calculateProgress = (
  event: ProgressEvent,
  startedAt: number,
): FileUploadState | undefined => {
  if (!event.lengthComputable || event.total <= 0) return;

  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const bytesPerSecond = event.loaded / elapsedSeconds;
  const remainingBytes = Math.max(event.total - event.loaded, 0);

  return {
    progress: Math.round((event.loaded / event.total) * 100),
    restTime: bytesPerSecond > 0 ? (remainingBytes / bytesPerSecond) * 1000 : 0,
    speed: bytesPerSecond / 1024,
  };
};

export class ServerService implements IImportService {
  importSettings: IImportService['importSettings'] = async (settings) => {
    await useUserStore.getState().importAppSettings(settings);
  };

  importData: IImportService['importData'] = async (data, callbacks) => {
    const handleError = createImportErrorHandler(callbacks);

    try {
      const expectedConversationVersion = await messageService.getConversationVersion();
      await this.uploadToImportEndpoint(data, {
        callbacks,
        expectedConversationVersion,
        strategy: 'merge',
      });
    } catch (error) {
      handleError(error);
    }
  };

  importPgData: IImportService['importPgData'] = async (
    data: ImportPgDataStructure,
    { callbacks, overwriteExisting, strategy } = {},
  ): Promise<void> => {
    const handleError = createImportErrorHandler(callbacks);

    try {
      const expectedConversationVersion = await messageService.getConversationVersion();
      await this.uploadToImportEndpoint(data, {
        callbacks,
        expectedConversationVersion,
        strategy: strategy || (overwriteExisting ? 'replace' : 'merge'),
      });
    } catch (error) {
      handleError(error);
    }
  };

  private uploadToImportEndpoint = async (
    data: object,
    {
      callbacks,
      expectedConversationVersion,
      strategy,
    }: {
      callbacks?: OnImportCallbacks;
      expectedConversationVersion: number;
      strategy: DataImportStrategy;
    },
  ): Promise<void> => {
    const authHeaders = new Headers(
      await createHeaderWithAuth({ headers: { 'Content-Type': 'application/json' } }),
    );
    const query = new URLSearchParams({
      expectedConversationVersion: String(expectedConversationVersion),
      strategy,
    });
    const startedAt = Date.now();

    callbacks?.onStageChange?.(ImportStage.Uploading);

    const result = await new Promise<any>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `/webapi/data/import?${query.toString()}`);
      authHeaders.forEach((value, key) => request.setRequestHeader(key, value));

      request.upload.addEventListener('progress', (event) => {
        const state = calculateProgress(event, startedAt);
        if (state) callbacks?.onFileUploading?.(state);
      });
      request.upload.addEventListener('load', () =>
        callbacks?.onStageChange?.(ImportStage.Importing),
      );
      request.addEventListener('error', () =>
        reject(
          new ImportRequestError({
            code: 'NETWORK_ERROR',
            httpStatus: 0,
            message: 'The backup could not be transferred to the server.',
          }),
        ),
      );
      request.addEventListener('load', () => {
        let response: any;
        try {
          response = JSON.parse(request.responseText);
        } catch {
          response = undefined;
        }

        if (request.status < 200 || request.status >= 300) {
          const isTransferTooLarge = request.status === 413;
          reject(
            new ImportRequestError({
              code: response?.code || (isTransferTooLarge ? 'TRANSFER_TOO_LARGE' : 'ImportError'),
              httpStatus: request.status,
              message:
                response?.message ||
                (isTransferTooLarge
                  ? 'The backup exceeds a proxy request-body limit. Increase the limit and retry.'
                  : `Import failed (${request.status})`),
            }),
          );
          return;
        }

        if (!response?.success) {
          reject(
            new ImportRequestError({
              code: 'IMPORT_FAILED_ROLLED_BACK',
              httpStatus: request.status,
              message: response?.error?.message || 'Import failed and was rolled back.',
            }),
          );
          return;
        }

        resolve(response);
      });

      request.send(JSON.stringify(data));
    });

    callbacks?.onStageChange?.(ImportStage.Success);
    callbacks?.onSuccess?.(result.results, Date.now() - startedAt);
  };
}
