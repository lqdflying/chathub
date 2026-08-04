import { GenerationTopicItem } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import { UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import {
  ImageGenerationTopic,
  ImageHistoryHousekeepingInput,
  ImageHistoryHousekeepingPreview,
  ImageHistoryHousekeepingResult,
} from '@/types/generation';

export class ServerService {
  async getAllGenerationTopics(): Promise<ImageGenerationTopic[]> {
    return lambdaClient.generationTopic.getAllGenerationTopics.query();
  }

  async createTopic(): Promise<string> {
    return lambdaClient.generationTopic.createTopic.mutate(undefined);
  }

  async updateTopic(id: string, data: UpdateTopicValue): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.updateTopic.mutate({ id, value: data });
  }

  async updateTopicCover(id: string, coverUrl: string): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.updateTopicCover.mutate({ coverUrl, id });
  }

  async deleteTopic(id: string): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.deleteTopic.mutate({ id });
  }

  async previewHousekeeping(
    input: ImageHistoryHousekeepingInput,
  ): Promise<ImageHistoryHousekeepingPreview> {
    return lambdaClient.generationTopic.previewHousekeeping.query(input);
  }

  async housekeep(input: ImageHistoryHousekeepingInput): Promise<ImageHistoryHousekeepingResult> {
    return lambdaClient.generationTopic.housekeep.mutate(input);
  }
}

export const generationTopicService = new ServerService();
