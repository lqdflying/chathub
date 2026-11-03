import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxEnvItem, SandboxEnvList } from '@lobechat/types';
import { createHmac } from 'node:crypto';

import { getServerDBConfig } from '@/config/db';
import { SandboxProfileEnvModel } from '@/database/models/sandboxProfileEnv';
import type { SandboxProfileEnvRow } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  SANDBOX_ENV_NAME_PATTERN,
  SANDBOX_ENV_VALUE_MAX_BYTES,
  isReservedSandboxEnvName,
} from '@/tools/sandbox/const';

import { isMissingTable } from './missingTable';

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

const unreadableSnapshot = () =>
  new SandboxEnvError('PRECONDITION_FAILED', 'The job environment snapshot could not be read.');

/** Why a variable name is refused, or undefined when it is allowed. */
export const sandboxEnvNameProblem = (name: string): string | undefined => {
  if (!SANDBOX_ENV_NAME_PATTERN.test(name)) {
    return 'Use capital letters, digits and underscores, starting with a letter or underscore (at most 64 characters).';
  }
  if (isReservedSandboxEnvName(name)) {
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
 * decrypted (the key changed, or the stored text is not ciphertext) is left
 * out; only its name is logged. A user's row that cannot be decrypted also
 * drops a shared value of that name, so the shared secret is not sent in its
 * place. A name that does not fit in the total size cap is left out, and
 * later names are still included when they fit.
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
    let decrypted: { plaintext: string; wasAuthentic: boolean };
    try {
      decrypted = await gateKeeper.decrypt(row.value);
    } catch {
      decrypted = { plaintext: '', wasAuthentic: false };
    }
    if (!decrypted.wasAuthentic) {
      console.warn('[sandbox] an environment variable could not be decrypted and was left out', {
        name: row.name,
        profileId,
      });
      // The user's override is what they asked to send. Do not fall back to shared.
      if (row.userId) delete env[row.name];
      continue;
    }
    env[row.name] = decrypted.plaintext;
  }

  let total = 0;
  for (const name of Object.keys(env).sort()) {
    const next = bytes(name) + bytes(env[name]) + 2;
    if (total + next > SANDBOX_ENV_TOTAL_MAX_BYTES) {
      console.warn('[sandbox] environment variables over the size cap were left out', {
        name,
        profileId,
      });
      delete env[name];
      continue;
    }
    total += next;
  }
  return env;
};

/** Ciphertext of an env map, or null when there is nothing to store. */
export const encryptSandboxEnvSnapshot = async (
  env: Record<string, string>,
): Promise<string | null> => {
  if (Object.keys(env).length === 0) return null;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return gateKeeper.encrypt(JSON.stringify(env));
};

/**
 * The env map stored on a job when it started. Null means the job has no
 * snapshot (it started before snapshots, or with no variables). A snapshot
 * that cannot be read is an error: the caller must not show output it cannot
 * mask.
 */
export const readSandboxEnvSnapshot = async (
  snapshot: string | null | undefined,
): Promise<Record<string, string>> => {
  if (!snapshot) return {};
  if (!isSandboxEnvAvailable()) throw unreadableSnapshot();
  try {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(snapshot);
    if (!wasAuthentic) throw unreadableSnapshot();
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadableSnapshot();
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') throw unreadableSnapshot();
      env[name] = value;
    }
    return env;
  } catch (error) {
    if (error instanceof SandboxEnvError) throw error;
    throw unreadableSnapshot();
  }
};

/**
 * Values to hide in one job's output: the ones it started with, then the
 * current ones. A name whose value changed keeps the old value under
 * `<name>_PREVIOUS` so both are masked.
 */
export const sandboxJobMaskEnv = (
  snapshot: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> => {
  const env: Record<string, string> = { ...snapshot };
  for (const [name, value] of Object.entries(current)) {
    const previous = env[name];
    if (previous === undefined || previous === value) {
      env[name] = value;
      continue;
    }
    let alias = `${name}_PREVIOUS`;
    while (Object.hasOwn(env, alias) && env[alias] !== previous) alias = `${alias}_PREVIOUS`;
    env[alias] = previous;
    env[name] = value;
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
  secrets: string[];
}

/** Masks already in the text; matched first so masking twice changes nothing. */
const MASK_TOKEN = String.raw`\[secret:[A-Z_][\dA-Z_]*]|\[redacted]`;

const tokenHoldsSecret = (token: string, secrets: readonly string[]) =>
  secrets.some((secret) => token.includes(secret));

/** A label that does not itself contain a value being hidden. */
const maskLabel = (name: string, secrets: readonly string[]) => {
  const labeled = `[secret:${name}]`;
  if (!tokenHoldsSecret(labeled, secrets)) return labeled;
  const redacted = '[redacted]';
  if (!tokenHoldsSecret(redacted, secrets)) return redacted;
  // Shorter than the shortest masked value, so it cannot contain one.
  return '\uFFFC';
};

const maskDeep = (value: unknown, masker: Masker): unknown => {
  if (typeof value === 'string') {
    return value.replace(masker.pattern, (match) => {
      const name = masker.names.get(match);
      return name ? maskLabel(name, masker.secrets) : match;
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
 * tool result with `[secret:NAME]`, or `[redacted]` when that label would
 * contain a value, so a value printed by a command does not end up in chat
 * history by accident. Not a defence against deliberate exfiltration:
 * anything in the sandbox can read the variables.
 */
export const maskSandboxSecrets = <T>(value: T, env: Record<string, string>): T => {
  const names = new Map<string, string>();
  for (const [name, secret] of Object.entries(env)) {
    if (secret.length >= SANDBOX_ENV_MASK_MIN_CHARS && !names.has(secret)) names.set(secret, name);
  }
  if (names.size === 0) return value;
  const secrets = [...names.keys()];
  // One pass, longest value first: a value that contains another is masked
  // whole, and a replacement (or an earlier mask) is never masked again.
  const pattern = new RegExp(
    [MASK_TOKEN, ...secrets.sort((a, b) => b.length - a.length).map(escapeRegExp)].join('|'),
    'g',
  );
  return maskDeep(value, { names, pattern, secrets }) as T;
};
