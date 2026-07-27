import { lambdaClient } from '@/libs/trpc/client';
import type { CreateImageServicePayload } from '@/server/routers/lambda/image/schema';

export class AiImageService {
  async createImage(payload: CreateImageServicePayload, signal?: AbortSignal) {
    return lambdaClient.image.createImage.mutate(payload, { signal });
  }
}

export const imageService = new AiImageService();
