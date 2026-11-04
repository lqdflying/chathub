import type { LobeChatDatabase } from '@lobechat/database';
import type { SandboxFileItem, SandboxFileList } from '@lobechat/types';
import { createHash, createHmac } from 'node:crypto';

import { getServerDBConfig } from '@/config/db';
import { SandboxProfileFileModel } from '@/database/models/sandboxProfileFile';
import type { SandboxProfileFileRow } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  SANDBOX_FILE_MAX_BYTES,
  SANDBOX_FILE_MODE_PATTERN,
  sandboxFilePathProblem,
} from '@/tools/sandbox/const';

import { isSandboxEnvAvailable } from './env';
import { isMissingTable } from './missingTable';

export const SANDBOX_FILE_MAX_PER_OWNER = 16;
/** Lines of a sensitive file this long or longer are masked on their own. */
export const SANDBOX_FILE_MASK_LINE_MIN_CHARS = 16;
/** Slices of a longer secret, so a truncated line still matches. */
const SANDBOX_FILE_MASK_SLICE_CHARS = 32;
const SANDBOX_FILE_MASK_SLICE_STEP = 16;

const MISSING_FILES_TABLE = /relation "sandbox_profile_files" does not exist/i;

/** Rows from the files table, or none while it does not exist yet (migration not run). */
const readOrNone = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch (error) {
    if (isMissingTable(error, MISSING_FILES_TABLE)) return [];
    throw error;
  }
};

export type SandboxFileOwner = { shared: true } | { userId: string };

export type SandboxFileErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'PRECONDITION_FAILED';

export class SandboxFileError extends Error {
  readonly code: SandboxFileErrorCode;

  constructor(code: SandboxFileErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SandboxFileError';
  }
}

/** One file as it is written into a new sandbox. */
export interface SandboxFileUpload {
  content: Uint8Array;
  /** Octal written as decimal, e.g. 600, as execd takes it. */
  mode: number;
  path: string;
}

/** What a user's sandbox of one profile gets, and what command output must hide. */
export interface ResolvedSandboxFiles {
  items: SandboxFileUpload[];
  /** Texts and long lines of the sensitive files, for `maskSandboxSecrets`. */
  mask: string[];
}

const requireAvailable = () => {
  if (!isSandboxEnvAvailable()) {
    throw new SandboxFileError(
      'PRECONDITION_FAILED',
      'Sandbox files need KEY_VAULTS_SECRET on the server to encrypt their content.',
    );
  }
};

/** Why a destination path is refused, or undefined when it is allowed. */
export const sandboxFilePathMessage = (path: string): string | undefined => {
  const problem = sandboxFilePathProblem(path);
  if (problem === 'format') {
    return 'Use an absolute path such as /root/.oci/config: letters, digits, and . _ - @ +, with no empty, "." or ".." parts.';
  }
  if (problem === 'blocked') {
    return `${path} is inside the workspace (/tmp/workspace) or a system folder (/proc, /sys, /dev).`;
  }
  return undefined;
};

const formatMode = (mode: number) => String(mode).padStart(3, '0');

/** The text of a file, or undefined when it is not valid UTF-8. */
const decodeText = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
};

/** Strict base64: what the browser sends is exactly what is stored. */
const decodeBase64 = (content: string) => {
  const bytes = Buffer.from(content, 'base64');
  return bytes.toString('base64') === content ? new Uint8Array(bytes) : undefined;
};

const toItem = (row: SandboxProfileFileRow, content?: string): SandboxFileItem => ({
  ...(content !== undefined ? { content } : {}),
  mode: formatMode(row.mode),
  path: row.path,
  sensitive: row.sensitive,
  size: row.size,
  updatedAt: row.updatedAt.toISOString(),
});

/** Bytes of a stored row, or undefined when it no longer decrypts. */
const decryptRow = async (gateKeeper: KeyVaultsGateKeeper, row: SandboxProfileFileRow) => {
  try {
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(row.content);
    if (!wasAuthentic) return undefined;
    return decodeBase64(plaintext);
  } catch {
    return undefined;
  }
};

/**
 * Shared files and this user's own, per profile. Content comes back only for
 * a file that is not sensitive and is UTF-8 text; a sensitive file never
 * leaves the server.
 */
export const listSandboxFiles = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<SandboxFileList> => {
  const model = new SandboxProfileFileModel(db);
  const rows = await readOrNone(() => model.listVisible(userId));
  const gateKeeper =
    rows.some((row) => !row.sensitive) && isSandboxEnvAvailable()
      ? await KeyVaultsGateKeeper.initWithEnvKey()
      : undefined;
  const profiles: SandboxFileList['profiles'] = {};
  for (const row of rows) {
    let content: string | undefined;
    if (!row.sensitive && gateKeeper) {
      const bytes = await decryptRow(gateKeeper, row);
      content = bytes && decodeText(bytes);
    }
    const entry = (profiles[row.profileId] ??= { mine: [], shared: [] });
    (row.userId ? entry.mine : entry.shared).push(toItem(row, content));
  }
  return { available: isSandboxEnvAvailable(), profiles };
};

/**
 * Adds or replaces a file. Without `content`, an existing file keeps its
 * content and only its mode and Sensitive flag change. The caller checks the
 * profile exists and who may write.
 */
export const setSandboxFile = async ({
  content,
  db,
  mode,
  owner,
  path,
  profileId,
  sensitive = true,
  updatedBy,
}: {
  /** The file's bytes in base64. */
  content?: string;
  db: LobeChatDatabase;
  /** Three octal digits, e.g. "600". */
  mode: string;
  owner: SandboxFileOwner;
  path: string;
  profileId: string;
  sensitive?: boolean;
  updatedBy: string;
}) => {
  requireAvailable();
  const pathProblem = sandboxFilePathMessage(path);
  if (pathProblem) throw new SandboxFileError('BAD_REQUEST', pathProblem);
  if (!SANDBOX_FILE_MODE_PATTERN.test(mode)) {
    throw new SandboxFileError('BAD_REQUEST', 'Use three octal digits for the mode, e.g. 600.');
  }
  const modeValue = Number(mode);

  const model = new SandboxProfileFileModel(db);
  const existing = await model.find(profileId, path, owner);

  if (content === undefined) {
    if (!existing) throw new SandboxFileError('BAD_REQUEST', 'Choose a file or paste its content.');
    await model.updateSettings(profileId, path, owner, { mode: modeValue, sensitive, updatedBy });
    return;
  }

  const bytes = decodeBase64(content);
  if (!bytes) throw new SandboxFileError('BAD_REQUEST', 'The file content could not be read.');
  if (bytes.byteLength === 0) throw new SandboxFileError('BAD_REQUEST', 'The file is empty.');
  if (bytes.byteLength > SANDBOX_FILE_MAX_BYTES) {
    throw new SandboxFileError(
      'BAD_REQUEST',
      `A file can be at most ${SANDBOX_FILE_MAX_BYTES / 1024} KB.`,
    );
  }
  if (!existing && (await model.count(profileId, owner)) >= SANDBOX_FILE_MAX_PER_OWNER) {
    throw new SandboxFileError(
      'BAD_REQUEST',
      `At most ${SANDBOX_FILE_MAX_PER_OWNER} files can be set here.`,
    );
  }

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const write = {
    encryptedContent: await gateKeeper.encrypt(content),
    mode: modeValue,
    path,
    profileId,
    sensitive,
    size: bytes.byteLength,
    updatedBy,
  };
  if ('userId' in owner) await model.upsertForUser(owner.userId, write);
  else await model.upsertShared(write);
};

export const deleteSandboxFile = async ({
  db,
  owner,
  path,
  profileId,
}: {
  db: LobeChatDatabase;
  owner: SandboxFileOwner;
  path: string;
  profileId: string;
}) => {
  const deleted = await new SandboxProfileFileModel(db).delete(profileId, path, owner);
  if (!deleted) throw new SandboxFileError('NOT_FOUND', `${path} is not set.`);
};

/** 32-character windows of a longer secret, stepped by 16. */
const addMaskSlices = (strings: Set<string>, value: string) => {
  if (value.length <= SANDBOX_FILE_MASK_SLICE_CHARS) return;
  for (
    let start = 0;
    start + SANDBOX_FILE_MASK_SLICE_CHARS <= value.length;
    start += SANDBOX_FILE_MASK_SLICE_STEP
  ) {
    strings.add(value.slice(start, start + SANDBOX_FILE_MASK_SLICE_CHARS));
  }
};

/** The text, long lines, and slices of a sensitive file, for masking command output. */
const maskStrings = (bytes: Uint8Array): string[] => {
  const text = decodeText(bytes);
  if (text === undefined) return [];
  const strings = new Set([text, text.trimEnd()]);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length >= SANDBOX_FILE_MASK_LINE_MIN_CHARS) strings.add(trimmed);
  }
  for (const value of strings) addMaskSlices(strings, value);
  return [...strings].filter(Boolean);
};

/**
 * The files one user's sandbox of one profile is created with: the shared
 * files, then the user's own on top by path. A file that cannot be decrypted
 * (the key changed) is left out; only its path is logged. A user's file that
 * cannot be decrypted also drops a shared file at that path, so the shared
 * file is not written in its place.
 */
export const resolveSandboxFiles = async (
  db: LobeChatDatabase,
  userId: string,
  profileId: string,
): Promise<ResolvedSandboxFiles> => {
  const model = new SandboxProfileFileModel(db);
  const rows = await readOrNone(() => model.listForSandbox(profileId, userId));
  if (!isSandboxEnvAvailable()) {
    if (rows.length > 0) {
      throw new SandboxFileError(
        'PRECONDITION_FAILED',
        'Sandbox files need KEY_VAULTS_SECRET on the server to encrypt their content.',
      );
    }
    return { items: [], mask: [] };
  }
  if (rows.length === 0) return { items: [], mask: [] };

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const byPath = new Map<string, { bytes: Uint8Array; row: SandboxProfileFileRow }>();
  // Shared first, so a user's own file at the same path wins.
  const ordered = [...rows].sort((a, b) => Number(!!a.userId) - Number(!!b.userId));
  for (const row of ordered) {
    const bytes = await decryptRow(gateKeeper, row);
    if (!bytes) {
      console.warn('[sandbox] a secret file could not be decrypted and was left out', {
        path: row.path,
        profileId,
      });
      if (row.userId) byPath.delete(row.path);
      continue;
    }
    byPath.set(row.path, { bytes, row });
  }

  const items: SandboxFileUpload[] = [];
  const mask: string[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const { bytes, row } = byPath.get(path)!;
    items.push({ content: bytes, mode: row.mode, path });
    if (row.sensitive) mask.push(...maskStrings(bytes));
  }
  return { items, mask };
};

/** Texts and long lines of the sensitive files, for masking a job's output. */
export const resolveSandboxFileMask = async (
  db: LobeChatDatabase,
  userId: string,
  profileId: string,
): Promise<string[]> => {
  const { mask } = await resolveSandboxFiles(db, userId, profileId);
  return mask;
};

const unreadableFileSnapshot = () =>
  new SandboxFileError('PRECONDITION_FAILED', 'The job file snapshot could not be read.');

/** Ciphertext of a file mask, or null when there is nothing to store. */
export const encryptSandboxFileSnapshot = async (
  mask: readonly string[],
): Promise<string | null> => {
  if (mask.length === 0) return null;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return gateKeeper.encrypt(JSON.stringify(mask));
};

/**
 * The file mask stored on a job when it started. Null means the job has no
 * snapshot (it started before snapshots, or with no files). A snapshot that
 * cannot be read is an error: the caller must not show output it cannot mask.
 */
export const readSandboxFileSnapshot = async (
  snapshot: string | null | undefined,
): Promise<string[]> => {
  if (!snapshot) return [];
  if (!isSandboxEnvAvailable()) throw unreadableFileSnapshot();
  try {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(snapshot);
    if (!wasAuthentic) throw unreadableFileSnapshot();
    const parsed: unknown = JSON.parse(plaintext);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw unreadableFileSnapshot();
    }
    return parsed;
  } catch (error) {
    if (error instanceof SandboxFileError) throw error;
    throw unreadableFileSnapshot();
  }
};

/** File texts to hide in one job's output: the ones it started with, then the current ones. */
export const sandboxJobFileMask = (
  snapshot: readonly string[],
  current: readonly string[],
): string[] => [...new Set([...snapshot, ...current])];

/**
 * A label telling whether a sandbox was created with these files, without
 * revealing them (an HMAC keyed by KEY_VAULTS_SECRET over each path, mode and
 * content hash). Undefined without files.
 */
export const sandboxFilesFingerprint = (items: SandboxFileUpload[]): string | undefined => {
  const key = getServerDBConfig().KEY_VAULTS_SECRET;
  if (items.length === 0 || !key) return undefined;
  const entries = [...items]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((item) => [item.path, item.mode, createHash('sha256').update(item.content).digest('hex')]);
  return createHmac('sha256', key).update(JSON.stringify(entries)).digest('hex').slice(0, 16);
};
