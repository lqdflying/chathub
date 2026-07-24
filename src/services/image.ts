import { lambdaClient } from '@/libs/trpc/client';
import type { CreateImageServicePayload } from '@/server/routers/lambda/image/schema';

export class AiImageService {
  async createImage(payload: CreateImageServicePayload) {
    return lambdaClient.image.createImage.mutate(payload);
  }
}

export const imageService = new AiImageService();
