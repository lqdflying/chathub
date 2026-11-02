import type { SandboxProfileItem } from '@lobechat/types';

export interface SandboxHubState {
  /** Operator profiles merged with this user's Hub choices. */
  sandboxProfiles: SandboxProfileItem[];
  /** When the profiles were last applied (ms epoch); a send reloads them after 5 minutes. */
  sandboxProfilesLoadedAt?: number;
  /** Account scope the profiles were loaded for; undefined = not loaded. */
  sandboxProfilesScope?: string;
}

export const initialSandboxHubState: SandboxHubState = {
  sandboxProfiles: [],
  sandboxProfilesLoadedAt: undefined,
  sandboxProfilesScope: undefined,
};
