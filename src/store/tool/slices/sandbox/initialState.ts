import type { SandboxProfileItem } from '@lobechat/types';

export interface SandboxHubState {
  /** Operator profiles merged with this user's Hub choices. */
  sandboxProfiles: SandboxProfileItem[];
  /** Account scope the profiles were loaded for; undefined = not loaded. */
  sandboxProfilesScope?: string;
}

export const initialSandboxHubState: SandboxHubState = {
  sandboxProfiles: [],
  sandboxProfilesScope: undefined,
};
