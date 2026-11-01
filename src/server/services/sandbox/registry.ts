import { getSandboxProfileCatalog, isSandboxProfileUsable } from './profiles/load';
import type { ResolvedSandboxProfile, ResolvedSandboxServer } from './profiles/schema';
import { OpenSandboxProvider } from './providers/opensandbox/provider';
import type { SandboxProvider } from './types';

/**
 * OpenSandbox is the only backend; the DifySandbox provider was removed.
 * Without a profile this is the OPENSANDBOX_* sandbox, as before Sandbox Hub.
 */
export const getSandboxProvider = (
  profile?: ResolvedSandboxProfile,
  server?: ResolvedSandboxServer,
): SandboxProvider => {
  if (!profile || !server) return new OpenSandboxProvider();
  return new OpenSandboxProvider({
    apiKey: server.apiKey,
    baseUrl: server.url,
    cpu: profile.cpu,
    egressAllow: profile.egress.mode === 'allowlist' ? profile.egress.targets : [],
    image: profile.image,
    memory: profile.memory,
    networkDisabled: profile.egress.mode === 'none',
    profileId: profile.id,
    readyTimeout: profile.readyTimeoutMs,
    sessionIdleTimeout: profile.sessionIdleTimeoutMs,
    sessionMaxLifetime: profile.sessionMaxLifetimeMs,
  });
};

/** At least one Sandbox Hub profile can run (its server has the credentials it declares). */
export const isSandboxConfigured = () =>
  getSandboxProfileCatalog().profiles.some((profile) => isSandboxProfileUsable(profile));
