import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';
import type { ZodError } from 'zod';

import { sandboxEnv } from '@/envs/sandbox';
import { SandboxManifest } from '@/tools/sandbox';
import { DEFAULT_SANDBOX_PROFILE_ID, sandboxToolIdentifier } from '@/tools/sandbox/const';

import { composeSandboxInstruction } from './compose';
import {
  DEFAULT_SANDBOX_SERVER_ID,
  type ResolvedSandboxProfile,
  type ResolvedSandboxServer,
  SANDBOX_INSTRUCTION_MAX_BYTES,
  type SandboxEgress,
  type SandboxProfileCatalog,
  type SandboxProfileConfig,
  sandboxProfilesFileSchema,
} from './schema';

/** The subset of `sandboxEnv` the loader reads; every profile field falls back to it. */
export interface SandboxProfilesEnv {
  OPENSANDBOX_API_KEY?: string;
  OPENSANDBOX_CPU: string;
  OPENSANDBOX_EGRESS_ALLOW?: string;
  OPENSANDBOX_IMAGE?: string;
  OPENSANDBOX_MEMORY: string;
  OPENSANDBOX_READY_TIMEOUT: number;
  OPENSANDBOX_SERVER_URL?: string;
  OPENSANDBOX_SESSION_IDLE_TIMEOUT: number;
  OPENSANDBOX_SESSION_MAX_LIFETIME: number;
  SANDBOX_PROFILES_FILE?: string;
}

export interface LoadSandboxProfilesOptions {
  env: SandboxProfilesEnv;
  /** Looks up `apiKeyEnv` names. */
  processEnv?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
}

const EMPTY = (errors: string[] = []): SandboxProfileCatalog => ({
  errors,
  profiles: [],
  servers: [],
  source: 'none',
});

const parseEgressAllow = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envEgress = (env: SandboxProfilesEnv): SandboxEgress => {
  const targets = parseEgressAllow(env.OPENSANDBOX_EGRESS_ALLOW);
  return targets.length > 0 ? { mode: 'allowlist', targets } : { mode: 'open' };
};

const toEgress = (
  value: SandboxProfileConfig['egress'],
  env: SandboxProfilesEnv,
): SandboxEgress => {
  if (value === undefined) return envEgress(env);
  if (value === 'open') return { mode: 'open' };
  if (value === 'none') return { mode: 'none' };
  return { mode: 'allowlist', targets: [...new Set(value)] };
};

const envServer = (env: SandboxProfilesEnv): ResolvedSandboxServer | undefined => {
  const url = env.OPENSANDBOX_SERVER_URL?.trim();
  if (!url) return undefined;
  return {
    apiKey: env.OPENSANDBOX_API_KEY || undefined,
    id: DEFAULT_SANDBOX_SERVER_ID,
    name: 'Default',
    proxyEndpoint: 'server',
    status: 'ok',
    url: url.replace(/\/+$/, ''),
  };
};

const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

/** Today's single sandbox, from OPENSANDBOX_* only. Byte-identical tool meta and instruction. */
const synthesizeFromEnv = (env: SandboxProfilesEnv): SandboxProfileCatalog => {
  const server = envServer(env);
  const image = env.OPENSANDBOX_IMAGE?.trim();
  if (!server || !image) return EMPTY();

  const { meta } = SandboxManifest;
  const profile: ResolvedSandboxProfile = {
    avatar: meta.avatar,
    cpu: env.OPENSANDBOX_CPU,
    defaultEnabled: true,
    description: meta.description ?? '',
    egress: envEgress(env),
    id: DEFAULT_SANDBOX_PROFILE_ID,
    identifier: sandboxToolIdentifier(DEFAULT_SANDBOX_PROFILE_ID),
    image,
    instruction: SandboxManifest.systemRole,
    memory: env.OPENSANDBOX_MEMORY,
    name: meta.title ?? 'Sandbox',
    readyTimeoutMs: env.OPENSANDBOX_READY_TIMEOUT,
    serverId: server.id,
    sessionIdleTimeoutMs: env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
    sessionMaxLifetimeMs: env.OPENSANDBOX_SESSION_MAX_LIFETIME,
  };
  return { errors: [], profiles: [profile], servers: [server], source: 'env' };
};

/**
 * Reads the operator's profiles file (YAML or JSON) or, without one, builds
 * the single `general` profile from OPENSANDBOX_*. A broken file configures
 * no profiles at all instead of silently falling back, so a typo cannot
 * quietly change which image or network policy users get.
 */
export const loadSandboxProfiles = ({
  env,
  processEnv = process.env,
  readFile = (path) => readFileSync(path, 'utf8'),
}: LoadSandboxProfilesOptions): SandboxProfileCatalog => {
  const filePath = env.SANDBOX_PROFILES_FILE?.trim();
  if (!filePath) return synthesizeFromEnv(env);

  let raw: unknown;
  try {
    raw = parse(readFile(filePath));
  } catch (error) {
    return EMPTY([
      `cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const parsed = sandboxProfilesFileSchema.safeParse(raw);
  if (!parsed.success) return EMPTY(formatZodError(parsed.error));

  const errors: string[] = [];
  const servers = new Map<string, ResolvedSandboxServer>();
  for (const server of parsed.data.servers ?? []) {
    const apiKey = server.apiKeyEnv ? processEnv[server.apiKeyEnv]?.trim() || undefined : undefined;
    servers.set(server.id, {
      apiKey,
      id: server.id,
      name: server.name ?? server.id,
      proxyEndpoint: server.proxyEndpoint,
      status: server.apiKeyEnv && !apiKey ? 'misconfigured' : 'ok',
      url: server.url.replace(/\/+$/, ''),
    });
  }
  if (!servers.has(DEFAULT_SANDBOX_SERVER_ID)) {
    const fallback = envServer(env);
    if (fallback) servers.set(fallback.id, fallback);
  }

  const baseDir = dirname(filePath);
  const profiles: ResolvedSandboxProfile[] = [];
  for (const config of parsed.data.profiles) {
    const where = `profiles.${config.id}`;
    if (!servers.has(config.server)) {
      errors.push(`${where}.server: unknown server "${config.server}"`);
      continue;
    }
    const image = config.image ?? env.OPENSANDBOX_IMAGE?.trim();
    if (!image) {
      errors.push(`${where}.image: no image and OPENSANDBOX_IMAGE is unset`);
      continue;
    }

    let text = config.instruction?.text;
    if (config.instruction?.file) {
      const instructionPath = isAbsolute(config.instruction.file)
        ? config.instruction.file
        : resolve(baseDir, config.instruction.file);
      try {
        text = readFile(instructionPath);
      } catch (error) {
        errors.push(
          `${where}.instruction.file: cannot read ${instructionPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }
    if (text && Buffer.byteLength(text, 'utf8') > SANDBOX_INSTRUCTION_MAX_BYTES) {
      errors.push(`${where}.instruction: larger than ${SANDBOX_INSTRUCTION_MAX_BYTES} bytes`);
      continue;
    }

    profiles.push({
      avatar: config.avatar,
      cpu: config.cpu ?? env.OPENSANDBOX_CPU,
      defaultEnabled: config.defaultEnabled ?? config.id === DEFAULT_SANDBOX_PROFILE_ID,
      description: config.description,
      egress: toEgress(config.egress, env),
      id: config.id,
      identifier: sandboxToolIdentifier(config.id),
      image,
      instruction: composeSandboxInstruction({
        base: config.instruction?.base ?? 'general',
        description: config.description,
        id: config.id,
        name: config.name,
        text,
      }),
      memory: config.memory ?? env.OPENSANDBOX_MEMORY,
      name: config.name,
      readyTimeoutMs: config.readyTimeoutMs ?? env.OPENSANDBOX_READY_TIMEOUT,
      serverId: config.server,
      sessionIdleTimeoutMs: config.sessionIdleTimeoutMs ?? env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
      sessionMaxLifetimeMs: config.sessionMaxLifetimeMs ?? env.OPENSANDBOX_SESSION_MAX_LIFETIME,
    });
  }

  // A partly broken file must not run with the remaining profiles: the
  // operator would not notice that one silently vanished.
  if (errors.length > 0) return EMPTY(errors);

  const usedServers = new Set(profiles.map((profile) => profile.serverId));
  return {
    errors,
    profiles,
    servers: [...servers.values()].filter((server) => usedServers.has(server.id)),
    source: 'file',
  };
};

let cached: { catalog: SandboxProfileCatalog; signature: string } | undefined;

const PROFILE_ENV_KEYS = [
  'OPENSANDBOX_API_KEY',
  'OPENSANDBOX_CPU',
  'OPENSANDBOX_EGRESS_ALLOW',
  'OPENSANDBOX_IMAGE',
  'OPENSANDBOX_MEMORY',
  'OPENSANDBOX_READY_TIMEOUT',
  'OPENSANDBOX_SERVER_URL',
  'OPENSANDBOX_SESSION_IDLE_TIMEOUT',
  'OPENSANDBOX_SESSION_MAX_LIFETIME',
  'SANDBOX_PROFILES_FILE',
] as const satisfies readonly (keyof SandboxProfilesEnv)[];

const readProfilesEnv = (): SandboxProfilesEnv =>
  Object.fromEntries(
    PROFILE_ENV_KEYS.map((key) => [key, sandboxEnv[key]]),
  ) as unknown as SandboxProfilesEnv;

/**
 * Loaded once per process (the durable worker runs in the same process), and
 * only reloaded when the OPENSANDBOX_* / SANDBOX_PROFILES_FILE values change.
 * Edits to the profiles file itself need a restart.
 */
export const getSandboxProfileCatalog = (): SandboxProfileCatalog => {
  const env = readProfilesEnv();
  const signature = JSON.stringify(env);
  if (cached?.signature === signature) return cached.catalog;
  const catalog = loadSandboxProfiles({ env });
  cached = { catalog, signature };
  if (catalog.errors.length > 0) {
    console.error(
      '[sandbox] SANDBOX_PROFILES_FILE is invalid; no sandbox profiles are configured',
      {
        errors: catalog.errors,
      },
    );
  }
  return catalog;
};

/** Test hook. */
export const resetSandboxProfileCatalog = () => {
  cached = undefined;
};

export const findSandboxProfile = (profileId: string) =>
  getSandboxProfileCatalog().profiles.find((profile) => profile.id === profileId);

export const findSandboxServer = (serverId: string) =>
  getSandboxProfileCatalog().servers.find((server) => server.id === serverId);

/** A profile can run when its server has the credentials it declares. */
export const isSandboxProfileUsable = (profile: ResolvedSandboxProfile) =>
  findSandboxServer(profile.serverId)?.status === 'ok';
