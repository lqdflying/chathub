import {
  ImageArtifactListInput,
  ImageArtifactListResult,
  ImageArtifactRemoveResult,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ArtifactService {
  list = async (input: ImageArtifactListInput = {}): Promise<ImageArtifactListResult> => {
    return lambdaClient.file.getImageArtifacts.query(input);
  };

  remove = async (ids: string[]): Promise<ImageArtifactRemoveResult> => {
    return lambdaClient.file.removeImageArtifacts.mutate({ ids });
  };
}

export const artifactService = new ArtifactService();
