import type {
  SandboxEnvList,
  SandboxFileList,
  SandboxHubAccess,
  SandboxHubJobList,
  SandboxHubProfileSettingsInput,
  SandboxHubSettings,
  SandboxProfileItem,
  SandboxServerHealth,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { SANDBOX_SHARED_INSTRUCTION_ID } from '@/tools/sandbox/const';

/** One file write: base64 `content` replaces the file; without it only mode and Sensitive change. */
export interface SandboxFileWriteInput {
  content?: string;
  mode: string;
  path: string;
  sensitive: boolean;
}

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

  deleteMyFile = (
    accountScope: string,
    profileId: string,
    path: string,
  ): Promise<SandboxFileList> =>
    lambdaClient.sandboxHub.deleteMyFile.mutate({ accountScope, path, profileId });

  deleteProfile = (accountScope: string, id: string): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.deleteProfile.mutate({ accountScope, id });

  deleteSharedEnv = (
    accountScope: string,
    profileId: string,
    name: string,
  ): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.deleteSharedEnv.mutate({ accountScope, name, profileId });

  deleteSharedFile = (
    accountScope: string,
    profileId: string,
    path: string,
  ): Promise<SandboxFileList> =>
    lambdaClient.sandboxHub.deleteSharedFile.mutate({ accountScope, path, profileId });

  listEnvs = (accountScope: string): Promise<SandboxEnvList> =>
    lambdaClient.sandboxHub.listEnvs.query({ accountScope });

  listFiles = (accountScope: string): Promise<SandboxFileList> =>
    lambdaClient.sandboxHub.listFiles.query({ accountScope });

  listHubJobs = (accountScope: string, page = 1): Promise<SandboxHubJobList> =>
    lambdaClient.sandboxHub.listHubJobs.query({ accountScope, page });

  purgeFinishedJobs = (accountScope: string): Promise<{ deleted: number }> =>
    lambdaClient.sandboxHub.purgeFinishedJobs.mutate({ accountScope });

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

  resetInstruction = (
    accountScope: string,
    profileId: typeof SANDBOX_SHARED_INSTRUCTION_ID,
  ): Promise<SandboxProfileItem[]> =>
    lambdaClient.sandboxHub.resetInstruction.mutate({ accountScope, profileId });

  serverStatus = (accountScope: string): Promise<Record<string, SandboxServerHealth>> =>
    lambdaClient.sandboxHub.serverStatus.query({ accountScope });

  setInstruction = (
    accountScope: string,
    profileId: typeof SANDBOX_SHARED_INSTRUCTION_ID,
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

  setMyFile = (
    accountScope: string,
    profileId: string,
    file: SandboxFileWriteInput,
  ): Promise<SandboxFileList> =>
    lambdaClient.sandboxHub.setMyFile.mutate({ accountScope, profileId, ...file });

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

  setSharedFile = (
    accountScope: string,
    profileId: string,
    file: SandboxFileWriteInput,
  ): Promise<SandboxFileList> =>
    lambdaClient.sandboxHub.setSharedFile.mutate({ accountScope, profileId, ...file });

  updateProfile = (
    accountScope: string,
    id: string,
    settings: SandboxHubProfileSettingsInput,
  ): Promise<SandboxHubSettings> =>
    lambdaClient.sandboxHub.updateProfile.mutate({ accountScope, id, settings });
}

export const sandboxHubService = new SandboxHubService();
