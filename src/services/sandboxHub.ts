import type { SandboxProfileItem, SandboxServerHealth } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class SandboxHubService {
  listProfiles = (accountScope: string): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.listProfiles.query({ accountScope });

  serverStatus = (accountScope: string): Promise<Record<string, SandboxServerHealth>> =>
    lambdaClient.sandboxHub.serverStatus.query({ accountScope });

  setProfileEnabled = (
    accountScope: string,
    profileId: string,
    enabled: boolean,
  ): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.setProfileEnabled.mutate({ accountScope, enabled, profileId });
}

export const sandboxHubService = new SandboxHubService();
