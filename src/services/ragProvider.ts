import type { RagProviderUpdate } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class RagProviderService {
  clearUserOverride = async () => lambdaClient.ragProvider.clearUserOverride.mutate();

  getStatus = async () => lambdaClient.ragProvider.getStatus.query();

  reindexAll = async () => lambdaClient.ragProvider.reindexAll.mutate();

  testConnection = async (config?: Partial<RagProviderUpdate>) =>
    lambdaClient.ragProvider.testConnection.mutate(config);

  update = async (config: RagProviderUpdate) => lambdaClient.ragProvider.update.mutate(config);
}

export const ragProviderService = new RagProviderService();
