import { validatePicbedMediaFile } from '@/helpers/picbedMedia';
import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { useUserStore } from '@/store/user';

export interface PicbedMediaUploadResult {
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

class PicbedService {
  uploadMedia = async (
    file: File,
    requestedScope: string,
    signal?: AbortSignal,
  ): Promise<PicbedMediaUploadResult> => {
    const validation = validatePicbedMediaFile(file);
    if (!validation.isValid) {
      throw new TypeError(`Invalid Picbed media: ${validation.reason}`);
    }

    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    const assertCurrentOwnership = () => {
      signal?.throwIfAborted();
      if (
        accountMutationSnapshot?.scope === requestedScope &&
        isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot)
      ) {
        return;
      }

      throw new DOMException('Picbed upload account changed', 'AbortError');
    };

    assertCurrentOwnership();
    const { data: metadata, success } = await uploadService.uploadFileToS3(file, { signal });

    assertCurrentOwnership();
    if (!success) throw new Error('Upload failed');

    // Store the S3 key path; the tRPC router resolves it to a full public URL
    const record = await lambdaClient.picbed.create.mutate(
      {
        fileType: file.type,
        name: file.name,
        requestedScope,
        size: file.size,
        url: metadata.path,
      },
      { signal },
    );
    assertCurrentOwnership();

    return {
      fileType: record.fileType,
      id: record.id,
      name: record.name,
      size: record.size,
      url: record.url, // full public URL resolved server-side
    };
  };

  list = async () => {
    return lambdaClient.picbed.list.query();
  };

  delete = async (id: string) => {
    return lambdaClient.picbed.delete.mutate({ id });
  };
}

export const picbedService = new PicbedService();
