import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxEnvItem, SandboxEnvList } from '@lobechat/types';
import { createHmac } from 'node:crypto';

import { getServerDBConfig } from '@/config/db';
import { SandboxProfileEnvModel } from '@/database/models/sandboxProfileEnv';
import type { SandboxProfileEnvRow } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { isMissingTable } from './missingTable';

export const SANDBOX_ENV_NAME = /^[A-Z_][\dA-Z_]{0,63}$/;
const RESERVED_NAMES = new Set([
  'HOME',
  'HOSTNAME',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'PATH',
  'PWD',
  'SHELL',
  'USER',
]);
const RESERVED_PREFIXES = ['CHATHUB_', 'EXECD_', 'OPENSANDBOX_'];

export const SANDBOX_ENV_VALUE_MAX_BYTES = 8 * 1024;
export const SANDBOX_ENV_MAX_PER_OWNER = 32;
export const SANDBOX_ENV_TOTAL_MAX_BYTES = 64 * 1024;
/** Shorter values are not masked in tool output: too likely to match ordinary text. */
export const SANDBOX_ENV_MASK_MIN_CHARS = 6;

const MISSING_ENV_TABLE = /relation "sandbox_profile_envs" does not exist/i;

/** Rows from the env table, or none while it does not exist yet (migration not run). */
const readOrNone = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch (error) {
    if (isMissingTable(error, MISSING_ENV_TABLE)) return [];
    throw error;
  }
};

export type SandboxEnvOwner = { shared: true } | { userId: string };

export type SandboxEnvErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'PRECONDITION_FAILED';

export class SandboxEnvError extends Error {
  readonly code: SandboxEnvErrorCode;

  constructor(code: SandboxEnvErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SandboxEnvError';
  }
}

const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

/** Why a variable name is refused, or undefined when it is allowed. */
export const sandboxEnvNameProblem = (name: string): string | undefined => {
  if (!SANDBOX_ENV_NAME.test(name)) {
    return 'Use capital letters, digits and underscores, starting with a letter or underscore (at most 64 characters).';
  }
  if (RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return `${name} is reserved by the sandbox.`;
  }
  return undefined;
};

/** Values are encrypted with KEY_VAULTS_SECRET; without it the feature is off. */
export const isSandboxEnvAvailable = () => !!getServerDBConfig().KEY_VAULTS_SECRET;

const requireAvailable = () => {
  if (!isSandboxEnvAvailable()) {
    throw new SandboxEnvError(
      'PRECONDITION_FAILED',
      'Sandbox environment variables need KEY_VAULTS_SECRET on the server to encrypt their values.',
    );
  }
};

/** Shows that a value is set without revealing it. */
export const sandboxEnvHint = (value: string) =>
  value.length >= 12 ? `••••${value.slice(-4)}` : '••••';

const toItem = (row: SandboxProfileEnvRow): SandboxEnvItem => ({
  ...(row.hint ? { hint: row.hint } : {}),
  name: row.name,
  updatedAt: row.updatedAt.toISOString(),
});

/** Names and hints of the shared variables and this user's own, per profile. */
export const listSandboxEnvs = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<SandboxEnvList> => {
  const model = new SandboxProfileEnvModel(db);
  const rows = await readOrNone(() => model.listVisible(userId));
  const profiles: SandboxEnvList['profiles'] = {};
  for (const row of rows) {
    const entry = (profiles[row.profileId] ??= { mine: [], shared: [] });
    (row.userId ? entry.mine : entry.shared).push(toItem(row));
  }
  return { available: isSandboxEnvAvailable(), profiles };
};

/** Adds or replaces a variable. The caller checks the profile exists and who may write. */
export const setSandboxEnv = async ({
  db,
  name,
  owner,
  profileId,
  updatedBy,
  value,
}: {
  db: LobeChatDatabase;
  name: string;
  owner: SandboxEnvOwner;
  profileId: string;
  updatedBy: string;
  value: string;
}) => {
  requireAvailable();
  const nameProblem = sandboxEnvNameProblem(name);
  if (nameProblem) throw new SandboxEnvError('BAD_REQUEST', nameProblem);
  if (value.length === 0) throw new SandboxEnvError('BAD_REQUEST', 'Enter a value.');
  if (bytes(value) > SANDBOX_ENV_VALUE_MAX_BYTES) {
    throw new SandboxEnvError(
      'BAD_REQUEST',
      `A value can be at most ${SANDBOX_ENV_VALUE_MAX_BYTES / 1024} KB.`,
    );
  }

  const model = new SandboxProfileEnvModel(db);
  const existing = await model.find(profileId, name, owner);
  if (!existing && (await model.count(profileId, owner)) >= SANDBOX_ENV_MAX_PER_OWNER) {
    throw new SandboxEnvError(
      'BAD_REQUEST',
      `At most ${SANDBOX_ENV_MAX_PER_OWNER} variables can be set here.`,
    );
  }

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const write = {
    encryptedValue: await gateKeeper.encrypt(value),
    hint: sandboxEnvHint(value),
    name,
    profileId,
    updatedBy,
  };
  if ('userId' in owner) await model.upsertForUser(owner.userId, write);
  else await model.upsertShared(write);
};

export const deleteSandboxEnv = async ({
  db,
  name,
  owner,
  profileId,
}: {
  db: LobeChatDatabase;
  name: string;
  owner: SandboxEnvOwner;
  profileId: string;
}) => {
  const deleted = await new SandboxProfileEnvModel(db).delete(profileId, name, owner);
  if (!deleted) throw new SandboxEnvError('NOT_FOUND', `${name} is not set.`);
};

/**
 * The variables one user's sandbox of one profile is created with: the
 * shared values, then the user's own on top. A value that cannot be
 * decrypted (the key changed) is left out; only its name is logged. Values
 * past the total size cap are left out the same way.
 */
export const resolveSandboxEnv = async (
  db: LobeChatDatabase,
  userId: string,
  profileId: string,
): Promise<Record<string, string>> => {
  if (!isSandboxEnvAvailable()) return {};
  const model = new SandboxProfileEnvModel(db);
  const rows = await readOrNone(() => model.listForSandbox(profileId, userId));
  if (rows.length === 0) return {};

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const env: Record<string, string> = {};
  // Shared first, so a user's own value of the same name wins.
  const ordered = [...rows].sort((a, b) => Number(!!a.userId) - Number(!!b.userId));
  for (const row of ordered) {
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(row.value);
    if (!wasAuthentic) {
      console.warn('[sandbox] an environment variable could not be decrypted and was left out', {
        name: row.name,
        profileId,
      });
      continue;
    }
    env[row.name] = plaintext;
  }

  let total = 0;
  for (const name of Object.keys(env).sort()) {
    total += bytes(name) + bytes(env[name]) + 2;
    if (total > SANDBOX_ENV_TOTAL_MAX_BYTES) {
      console.warn('[sandbox] environment variables over the size cap were left out', {
        name,
        profileId,
      });
      delete env[name];
    }
  }
  return env;
};

/**
 * A label telling whether a sandbox was created with these values, without
 * revealing them (an HMAC keyed by KEY_VAULTS_SECRET). Undefined without
 * variables.
 */
export const sandboxEnvFingerprint = (env: Record<string, string>): string | undefined => {
  const names = Object.keys(env).sort();
  const key = getServerDBConfig().KEY_VAULTS_SECRET;
  if (names.length === 0 || !key) return undefined;
  return createHmac('sha256', key)
    .update(JSON.stringify(names.map((name) => [name, env[name]])))
    .digest('hex')
    .slice(0, 16);
};

const escapeRegExp = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

interface Masker {
  names: Map<string, string>;
  pattern: RegExp;
}

/** A mask already in the text; matched first so masking twice changes nothing. */
const MASK_TOKEN = String.raw`\[secret:[A-Z_][\dA-Z_]*]`;

const maskDeep = (value: unknown, masker: Masker): unknown => {
  if (typeof value === 'string') {
    return value.replace(masker.pattern, (match) => {
      const name = masker.names.get(match);
      return name ? `[secret:${name}]` : match;
    });
  }
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, masker));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskDeep(item, masker)]),
    );
  }
  return value;
};

/**
 * Replaces each variable value (6 characters or more) in every string of a
 * tool result with `[secret:NAME]`, so a value printed by a command does not
 * end up in chat history by accident. Not a defence against deliberate
 * exfiltration: anything in the sandbox can read the variables.
 */
export const maskSandboxSecrets = <T>(value: T, env: Record<string, string>): T => {
  const names = new Map<string, string>();
  for (const [name, secret] of Object.entries(env)) {
    if (secret.length >= SANDBOX_ENV_MASK_MIN_CHARS && !names.has(secret)) names.set(secret, name);
  }
  if (names.size === 0) return value;
  // One pass, longest value first: a value that contains another is masked
  // whole, and a replacement (or an earlier mask) is never masked again.
  const pattern = new RegExp(
    [MASK_TOKEN, ...[...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)].join(
      '|',
    ),
    'g',
  );
  return maskDeep(value, { names, pattern }) as T;
};
