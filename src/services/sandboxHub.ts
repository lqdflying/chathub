import type {
  SandboxHubAccess,
  SandboxProfileItem,
  SandboxServerHealth,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class SandboxHubService {
  access = (accountScope: string): Promise<SandboxHubAccess> =>
    lambdaClient.sandboxHub.access.query({ accountScope });

  listProfiles = (accountScope: string): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.listProfiles.query({ accountScope });

  resetInstruction = (accountScope: string, profileId: string): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.resetInstruction.mutate({ accountScope, profileId });

  serverStatus = (accountScope: string): Promise<Record<string, SandboxServerHealth>> =>
    lambdaClient.sandboxHub.serverStatus.query({ accountScope });

  setInstruction = (
    accountScope: string,
    profileId: string,
    instruction: string,
  ): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.setInstruction.mutate({ accountScope, instruction, profileId });

  setProfileEnabled = (
    accountScope: string,
    profileId: string,
    enabled: boolean,
  ): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.setProfileEnabled.mutate({ accountScope, enabled, profileId });
}

export const sandboxHubService = new SandboxHubService();
