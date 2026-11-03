import { z } from 'zod';

import {
  DEFAULT_SANDBOX_PROFILE_ID,
  SANDBOX_PROFILE_ID_MAX_LENGTH,
  isValidSandboxProfileId,
} from '@/tools/sandbox/const';

export { SANDBOX_INSTRUCTION_MAX_BYTES } from '@/tools/sandbox/const';

export const SANDBOX_PROFILES_MAX = 16;
export const DEFAULT_SANDBOX_SERVER_ID = 'default';

const ENV_NAME = /^[A-Z_][\dA-Z_]*$/;
const SERVER_ID = /^[a-z][\da-z]*(?:-[\da-z]+)*$/;

const positiveMs = z.number().int().positive();
const nonNegativeMs = z.number().int().min(0);

export const sandboxServerConfigSchema = z
  .object({
    /** Environment variable that holds the server API key; keys never live in the file. */
    apiKeyEnv: z
      .string()
      .regex(ENV_NAME, 'apiKeyEnv must be an environment variable name')
      .optional(),
    id: z
      .string()
      .min(1)
      .max(32)
      .regex(SERVER_ID, 'server id must be lowercase letters, digits and hyphens'),
    name: z.string().min(1).max(64).optional(),
    /**
     * `baseUrl`: send execd proxy calls to `url` even when the server returns
     * another host (for example behind a TLS reverse proxy). Default `server`.
     */
    proxyEndpoint: z.enum(['baseUrl', 'server']).default('server'),
    /**
     * Private-registry logins for images this server pulls, matched by the
     * image's registry host. Credentials stay in the environment.
     */
    registries: z
      .array(
        z
          .object({
            host: z.string().trim().min(1).max(253),
            passwordEnv: z
              .string()
              .regex(ENV_NAME, 'passwordEnv must be an environment variable name'),
            usernameEnv: z
              .string()
              .regex(ENV_NAME, 'usernameEnv must be an environment variable name'),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    url: z.string().url(),
  })
  .strict();

export const sandboxEgressSchema = z.union([
  z.literal('open'),
  z.literal('none'),
  z.array(z.string().trim().min(1).max(253)).min(1).max(64),
]);

export const sandboxInstructionSchema = z
  .object({
    /** `general` prepends the default Sandbox instruction (API contract); `none` uses only this text. */
    base: z.enum(['general', 'none']).default('general'),
    /** Markdown file, relative to the profiles file. */
    file: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.file && value.text), {
    message: 'set instruction.file or instruction.text, not both',
  });

export const sandboxProfileConfigSchema = z
  .object({
    avatar: z
      .string()
      .min(1)
      .max(64 * 1024)
      .optional(),
    cpu: z.string().min(1).max(16).optional(),
    defaultEnabled: z.boolean().optional(),
    description: z.string().min(1).max(280),
    egress: sandboxEgressSchema.optional(),
    id: z.string().refine(isValidSandboxProfileId, {
      message: `profile id must be lowercase letters, digits and single hyphens, at most ${SANDBOX_PROFILE_ID_MAX_LENGTH} characters`,
    }),
    image: z.string().trim().min(1).max(512).optional(),
    instruction: sandboxInstructionSchema.optional(),
    /** Longest a background job may run; 0 turns jobs off. Default SANDBOX_JOB_MAX_RUNTIME. */
    jobMaxRuntimeMs: nonNegativeMs.optional(),
    memory: z.string().min(1).max(16).optional(),
    name: z.string().min(1).max(64),
    readyTimeoutMs: positiveMs.optional(),
    server: z.string().min(1).default(DEFAULT_SANDBOX_SERVER_ID),
    sessionIdleTimeoutMs: nonNegativeMs.optional(),
    sessionMaxLifetimeMs: nonNegativeMs.optional(),
  })
  .strict();

export const sandboxProfilesFileSchema = z
  .object({
    /**
     * Imported into Sandbox Hub once, while the Hub has no profiles; after
     * that the Hub owns them. A file may list only servers.
     */
    profiles: z.array(sandboxProfileConfigSchema).max(SANDBOX_PROFILES_MAX).default([]),
    servers: z.array(sandboxServerConfigSchema).max(16).optional(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const profileIds = new Set<string>();
    for (const [index, profile] of file.profiles.entries()) {
      if (profileIds.has(profile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate profile id "${profile.id}"`,
          path: ['profiles', index, 'id'],
        });
      }
      profileIds.add(profile.id);
    }
    const serverIds = new Set<string>();
    for (const [index, server] of (file.servers ?? []).entries()) {
      if (serverIds.has(server.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate server id "${server.id}"`,
          path: ['servers', index, 'id'],
        });
      }
      serverIds.add(server.id);
    }
  });

export type SandboxServerConfig = z.infer<typeof sandboxServerConfigSchema>;
export type SandboxProfileConfig = z.infer<typeof sandboxProfileConfigSchema>;
export type SandboxProfilesFile = z.infer<typeof sandboxProfilesFileSchema>;

export type SandboxEgress =
  { mode: 'allowlist'; targets: string[] } | { mode: 'none' } | { mode: 'open' };

export interface SandboxRegistryLogin {
  host: string;
  password: string;
  username: string;
}

export interface ResolvedSandboxServer {
  apiKey?: string;
  id: string;
  name: string;
  proxyEndpoint: 'baseUrl' | 'server';
  /** Registry logins whose variables are set; omitted when there are none. */
  registries?: SandboxRegistryLogin[];
  /** `misconfigured` when `apiKeyEnv` names a variable that is not set. */
  status: 'misconfigured' | 'ok';
  url: string;
}

export interface ResolvedSandboxProfile {
  avatar?: string;
  cpu: string;
  defaultEnabled: boolean;
  description: string;
  egress: SandboxEgress;
  id: string;
  identifier: string;
  image: string;
  /** `general` builds on the General instruction; `none` uses only this profile's text. */
  instructionBase: 'general' | 'none';
  /** This profile's own text. Blank means none. */
  instructionText?: string;
  /** Longest a background job may keep the sandbox alive; 0 = jobs off. */
  jobMaxRuntimeMs: number;
  memory: string;
  name: string;
  readyTimeoutMs: number;
  serverId: string;
  sessionIdleTimeoutMs: number;
  sessionMaxLifetimeMs: number;
}

/** A profile as the file (or OPENSANDBOX_*) defines it, before defaults are applied. */
export interface SandboxProfileSeed {
  config: SandboxProfileConfig;
  /** Instruction text, already read from `instruction.file` when the file names one. */
  text?: string;
}

export interface SandboxProfileCatalog {
  /** Human-readable load problems, already logged once. */
  errors: string[];
  profiles: ResolvedSandboxProfile[];
  /** The file or env profiles in raw form, imported into an empty Sandbox Hub. */
  seeds: SandboxProfileSeed[];
  servers: ResolvedSandboxServer[];
  /**
   * `env`: synthesized from OPENSANDBOX_*; `file`: SANDBOX_PROFILES_FILE;
   * `hub`: profiles managed in Sandbox Hub; `none`: nothing usable.
   */
  source: 'env' | 'file' | 'hub' | 'none';
  /** Problems that do not stop loading (an unset registry variable), logged once. */
  warnings: string[];
}

export const isDefaultSandboxProfile = (profile: Pick<ResolvedSandboxProfile, 'id'>) =>
  profile.id === DEFAULT_SANDBOX_PROFILE_ID;
