import type {
  SandboxEnvList,
  SandboxHubAccess,
  SandboxHubJobList,
  SandboxHubProfileSettingsInput,
  SandboxHubSettings,
  SandboxProfileItem,
  SandboxServerHealth,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class SandboxHubService {
  access = (accountScope: string): Promise<SandboxHubAccess> =>
    lambdaClient.sandboxHub.access.query({ accountScope });

  cancelJob = (accountScope: string, jobId: string): Promise<void> =>
    lambdaClient.sandboxHub.cancelJob.mutate({ accountScope, jobId });

  createProfile = (
    accountScope: string,
    id: string,
    settings: SandboxHubProfileSettingsInput,
  ): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.createProfile.mutate({ accountScope, id, settings });

  deleteMyEnv = (accountScope: string, profileId: string, name: string): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.deleteMyEnv.mutate({ accountScope, name, profileId });

  deleteProfile = (accountScope: string, id: string): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.deleteProfile.mutate({ accountScope, id });

  deleteSharedEnv = (
    accountScope: string,
    profileId: string,
    name: string,
  ): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.deleteSharedEnv.mutate({ accountScope, name, profileId });

  listEnvs = (accountScope: string): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.listEnvs.query({ accountScope });

  listHubJobs = (accountScope: string, page = 1): Promise<SandboxHubJobList> =>
    lambdaClient.sandboxHub.listHubJobs.query({ accountScope, page });

  purgeSucceededJobs = (accountScope: string): Promise<{ deleted: number }> =>
    lambdaClient.sandboxHub.purgeSucceededJobs.mutate({ accountScope });

  listProfiles = (accountScope: string): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.listProfiles.query({ accountScope });

  moveProfile = (
    accountScope: string,
    id: string,
    direction: 'down' | 'up',
  ): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.moveProfile.mutate({ accountScope, direction, id });

  prepareImage = (accountScope: string, id: string): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.prepareImage.mutate({ accountScope, id });

  profileSettings = (accountScope: string): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.profileSettings.query({ accountScope });

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

  setMyEnv = (
    accountScope: string,
    profileId: string,
    name: string,
    value: string,
    sensitive = true,
  ): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.setMyEnv.mutate({ accountScope, name, profileId, sensitive, value });

  setProfileEnabled = (
    accountScope: string,
    profileId: string,
    enabled: boolean,
  ): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.setProfileEnabled.mutate({ accountScope, enabled, profileId });

  setSharedEnv = (
    accountScope: string,
    profileId: string,
    name: string,
    value: string,
    sensitive = true,
  ): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.setSharedEnv.mutate({
      accountScope,
      name,
      profileId,
      sensitive,
      value,
    });

  updateProfile = (
    accountScope: string,
    id: string,
    settings: SandboxHubProfileSettingsInput,
  ): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.updateProfile.mutate({ accountScope, id, settings });
}

export const sandboxHubService = new SandboxHubService();
