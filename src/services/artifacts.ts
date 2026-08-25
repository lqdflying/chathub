import { ImageArtifactListInput, ImageArtifactListResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ArtifactService {
  list = async (input: ImageArtifactListInput = {}): Promise<ImageArtifactListResult> => {
    return lambdaClient.file.getImageArtifacts.query(input);
  };

  remove = async (ids: string[]): Promise<void> => {
    await lambdaClient.file.removeImageArtifacts.mutate({ ids });
  };
}

export const artifactService = new ArtifactService();
