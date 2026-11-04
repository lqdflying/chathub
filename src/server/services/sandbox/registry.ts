import { getSandboxFileCatalog } from './profiles/load';
import type { ResolvedSandboxProfile, ResolvedSandboxServer } from './profiles/schema';
import {
  OpenSandboxProvider,
  type SandboxEnvSpec,
  type SandboxFilesSpec,
} from './providers/opensandbox/provider';
import { registryLoginFor } from './registryAuth';
import type { SandboxProvider } from './types';

/**
 * OpenSandbox is the only backend; the DifySandbox provider was removed.
 * Without a profile this is the OPENSANDBOX_* sandbox, as before Sandbox Hub.
 * `env` and `files` are for tool calls only: given, a new sandbox gets these
 * variables and files, and a reused one created with others is replaced.
 */
export const getSandboxProvider = (
  profile?: ResolvedSandboxProfile,
  server?: ResolvedSandboxServer,
  options: { env?: SandboxEnvSpec; files?: SandboxFilesSpec } = {},
): SandboxProvider => {
  if (!profile || !server) return new OpenSandboxProvider();
  const login = registryLoginFor(profile.image, server.registries);
  return new OpenSandboxProvider({
    apiKey: server.apiKey,
    baseUrl: server.url,
    cpu: profile.cpu,
    egressAllow: profile.egress.mode === 'allowlist' ? profile.egress.targets : [],
    ...(options.env ? { env: options.env } : {}),
    ...(options.files ? { files: options.files } : {}),
    image: profile.image,
    ...(login ? { imageAuth: { password: login.password, username: login.username } } : {}),
    memory: profile.memory,
    networkDisabled: profile.egress.mode === 'none',
    profileId: profile.id,
    readyTimeout: profile.readyTimeoutMs,
    rebaseExecdEndpoint: server.proxyEndpoint === 'baseUrl',
    sessionIdleTimeout: profile.sessionIdleTimeoutMs,
    sessionMaxLifetime: profile.sessionMaxLifetimeMs,
  });
};

/**
 * At least one sandbox server has the credentials it declares. Profiles live
 * in Sandbox Hub, so this stays true with none yet: admins add them there.
 */
export const isSandboxConfigured = () =>
  getSandboxFileCatalog().servers.some((server) => server.status === 'ok');
