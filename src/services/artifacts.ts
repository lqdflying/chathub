import { ImageArtifactListInput, ImageArtifactListResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ArtifactService {
  list = async (input: ImageArtifactListInput = {}): Promise<ImageArtifactListResult> => {
    return lambdaClient.file.getImageArtifacts.query(input);
  };
}

export const artifactService = new ArtifactService();
