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
  type SandboxProfileSeed,
  type SandboxRegistryLogin,
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
  SANDBOX_JOB_MAX_RUNTIME?: number;
  SANDBOX_PROFILES_FILE?: string;
}

/** Background job runtime cap when SANDBOX_JOB_MAX_RUNTIME is not given (2 hours). */
export const DEFAULT_SANDBOX_JOB_MAX_RUNTIME_MS = 7_200_000;

const envJobMaxRuntime = (env: SandboxProfilesEnv) =>
  env.SANDBOX_JOB_MAX_RUNTIME ?? DEFAULT_SANDBOX_JOB_MAX_RUNTIME_MS;

export interface LoadSandboxProfilesOptions {
  env: SandboxProfilesEnv;
  /** Looks up `apiKeyEnv` names. */
  processEnv?: Record<string, string | undefined>;
  readFile?: (path: string) => string;
}

const EMPTY = (errors: string[] = []): SandboxProfileCatalog => ({
  errors,
  profiles: [],
  seeds: [],
  servers: [],
  source: 'none',
  warnings: [],
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
  const seed: SandboxProfileSeed = {
    config: {
      avatar: meta.avatar,
      defaultEnabled: true,
      description: meta.description ?? '',
      id: DEFAULT_SANDBOX_PROFILE_ID,
      name: meta.title ?? 'Sandbox',
      server: server.id,
    },
  };
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
    jobMaxRuntimeMs: envJobMaxRuntime(env),
    memory: env.OPENSANDBOX_MEMORY,
    name: meta.title ?? 'Sandbox',
    readyTimeoutMs: env.OPENSANDBOX_READY_TIMEOUT,
    serverId: server.id,
    sessionIdleTimeoutMs: env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
    sessionMaxLifetimeMs: env.OPENSANDBOX_SESSION_MAX_LIFETIME,
  };
  return {
    errors: [],
    profiles: [profile],
    seeds: [seed],
    servers: [server],
    source: 'env',
    warnings: [],
  };
};

/**
 * Applies the OPENSANDBOX_* defaults to one profile config and composes its
 * starting instruction. Shared by the profiles file and Sandbox Hub, so both
 * resolve a profile the same way. Fails only when no image is known.
 */
export const resolveProfileConfig = (
  config: SandboxProfileConfig,
  env: SandboxProfilesEnv,
  text?: string,
): { error: string; ok: false } | { ok: true; profile: ResolvedSandboxProfile } => {
  const image = config.image ?? env.OPENSANDBOX_IMAGE?.trim();
  if (!image) return { error: 'no image and OPENSANDBOX_IMAGE is unset', ok: false };
  return {
    ok: true,
    profile: {
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
      jobMaxRuntimeMs: config.jobMaxRuntimeMs ?? envJobMaxRuntime(env),
      memory: config.memory ?? env.OPENSANDBOX_MEMORY,
      name: config.name,
      readyTimeoutMs: config.readyTimeoutMs ?? env.OPENSANDBOX_READY_TIMEOUT,
      serverId: config.server,
      sessionIdleTimeoutMs: config.sessionIdleTimeoutMs ?? env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
      sessionMaxLifetimeMs: config.sessionMaxLifetimeMs ?? env.OPENSANDBOX_SESSION_MAX_LIFETIME,
    },
  };
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
  const warnings: string[] = [];
  const servers = new Map<string, ResolvedSandboxServer>();
  for (const server of parsed.data.servers ?? []) {
    const apiKey = server.apiKeyEnv ? processEnv[server.apiKeyEnv]?.trim() || undefined : undefined;
    const registries: SandboxRegistryLogin[] = [];
    for (const registry of server.registries ?? []) {
      const username = processEnv[registry.usernameEnv]?.trim();
      const password = processEnv[registry.passwordEnv];
      if (!username || !password) {
        warnings.push(
          `servers.${server.id}.registries.${registry.host}: ${!username ? registry.usernameEnv : registry.passwordEnv} is unset; images from ${registry.host} are pulled without a login`,
        );
        continue;
      }
      registries.push({ host: registry.host.toLowerCase(), password, username });
    }
    servers.set(server.id, {
      apiKey,
      id: server.id,
      name: server.name ?? server.id,
      proxyEndpoint: server.proxyEndpoint,
      ...(registries.length > 0 ? { registries } : {}),
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
  const seeds: SandboxProfileSeed[] = [];
  for (const config of parsed.data.profiles) {
    const where = `profiles.${config.id}`;
    if (!servers.has(config.server)) {
      errors.push(`${where}.server: unknown server "${config.server}"`);
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

    const resolved = resolveProfileConfig(config, env, text);
    if (!resolved.ok) {
      errors.push(`${where}.image: ${resolved.error}`);
      continue;
    }
    profiles.push(resolved.profile);
    seeds.push({ config, ...(text ? { text } : {}) });
  }

  // A partly broken file must not run with the remaining profiles: the
  // operator would not notice that one silently vanished.
  if (errors.length > 0) return EMPTY(errors);

  // Every server is listed, used or not: Sandbox Hub admins pick from them.
  return {
    errors,
    profiles,
    seeds,
    servers: [...servers.values()],
    source: 'file',
    warnings,
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
  'SANDBOX_JOB_MAX_RUNTIME',
  'SANDBOX_PROFILES_FILE',
] as const satisfies readonly (keyof SandboxProfilesEnv)[];

/** The OPENSANDBOX_* defaults every profile falls back to. */
export const readSandboxProfilesEnv = (): SandboxProfilesEnv =>
  Object.fromEntries(
    PROFILE_ENV_KEYS.map((key) => [key, sandboxEnv[key]]),
  ) as unknown as SandboxProfilesEnv;

/**
 * The profiles file (or OPENSANDBOX_*) as loaded: the servers, plus the
 * profiles used to seed Sandbox Hub and as the fallback while the Hub table
 * does not exist. Loaded once per process (the durable worker runs in the
 * same process) and only reloaded when the OPENSANDBOX_* /
 * SANDBOX_JOB_MAX_RUNTIME / SANDBOX_PROFILES_FILE values change. Edits to the
 * file itself need a restart. Profiles in use come from
 * `getSandboxProfileCatalog(db)` (`hub.ts`).
 */
export const getSandboxFileCatalog = (): SandboxProfileCatalog => {
  const env = readSandboxProfilesEnv();
  const signature = JSON.stringify(env);
  if (cached?.signature === signature) return cached.catalog;
  const catalog = loadSandboxProfiles({ env });
  cached = { catalog, signature };
  if (catalog.errors.length > 0) {
    console.error(
      '[sandbox] SANDBOX_PROFILES_FILE is invalid; no sandbox servers or profiles are configured',
      { errors: catalog.errors },
    );
  }
  if (catalog.warnings.length > 0) {
    console.warn('[sandbox] SANDBOX_PROFILES_FILE warnings', { warnings: catalog.warnings });
  }
  return catalog;
};

/** Test hook. */
export const resetSandboxFileCatalog = () => {
  cached = undefined;
};

export const findSandboxServer = (serverId: string) =>
  getSandboxFileCatalog().servers.find((server) => server.id === serverId);

/** A profile can run when its server has the credentials it declares. */
export const isSandboxProfileUsable = (profile: ResolvedSandboxProfile) =>
  findSandboxServer(profile.serverId)?.status === 'ok';
