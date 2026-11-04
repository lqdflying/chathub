import { and, count, eq, isNull, or, sql } from 'drizzle-orm';

import { type SandboxProfileFileRow, sandboxProfileFiles } from '../schemas/sandboxProfile';
import { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';

export interface SandboxFileWrite {
  /** Already encrypted by the caller (base64 bytes, then ciphertext). */
  encryptedContent: string;
  /** Octal written as decimal, e.g. 600. */
  mode: number;
  path: string;
  profileId: string;
  /** When false, the Hub may show the content and command output is not masked. */
  sensitive: boolean;
  size: number;
  updatedBy: string;
}

/** Who owns a file: everyone (shared) or one user. */
type Owner = { shared: true } | { userId: string };

const ownerFilter = (owner: Owner) =>
  'userId' in owner
    ? eq(sandboxProfileFiles.userId, owner.userId)
    : isNull(sandboxProfileFiles.userId);

/**
 * Sandbox Hub secret files. Not scoped by user: callers check that a shared
 * write comes from an admin and a user's write from that user.
 */
export class SandboxProfileFileModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /** Shared files and this user's own, for every profile, by path. */
  listVisible = async (userId: string): Promise<SandboxProfileFileRow[]> =>
    this.db
      .select()
      .from(sandboxProfileFiles)
      .where(or(isNull(sandboxProfileFiles.userId), eq(sandboxProfileFiles.userId, userId)))
      .orderBy(sandboxProfileFiles.profileId, sandboxProfileFiles.path);

  /** What one user's sandbox of one profile gets: shared rows and the user's own. */
  listForSandbox = async (profileId: string, userId: string): Promise<SandboxProfileFileRow[]> =>
    this.db
      .select()
      .from(sandboxProfileFiles)
      .where(
        and(
          eq(sandboxProfileFiles.profileId, profileId),
          or(isNull(sandboxProfileFiles.userId), eq(sandboxProfileFiles.userId, userId)),
        ),
      );

  count = async (profileId: string, owner: Owner): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(sandboxProfileFiles)
      .where(and(eq(sandboxProfileFiles.profileId, profileId), ownerFilter(owner)));
    return Number(row?.value ?? 0);
  };

  find = async (profileId: string, path: string, owner: Owner) => {
    const [row] = await this.db
      .select()
      .from(sandboxProfileFiles)
      .where(
        and(
          eq(sandboxProfileFiles.profileId, profileId),
          eq(sandboxProfileFiles.path, path),
          ownerFilter(owner),
        ),
      )
      .limit(1);
    return row;
  };

  /** Adds or replaces a file shared by every user of the profile. */
  upsertShared = async (write: SandboxFileWrite) => {
    const now = new Date();
    await this.db
      .insert(sandboxProfileFiles)
      .values({
        content: write.encryptedContent,
        id: idGenerator('sandboxFiles'),
        mode: write.mode,
        path: write.path,
        profileId: write.profileId,
        sensitive: write.sensitive,
        size: write.size,
        updatedAt: now,
        updatedBy: write.updatedBy,
        userId: null,
      })
      .onConflictDoUpdate({
        set: {
          content: write.encryptedContent,
          mode: write.mode,
          sensitive: write.sensitive,
          size: write.size,
          updatedAt: now,
          updatedBy: write.updatedBy,
        },
        target: [sandboxProfileFiles.profileId, sandboxProfileFiles.path],
        targetWhere: sql`${sandboxProfileFiles.userId} is null`,
      });
  };

  /** Adds or replaces one user's own file for the profile. */
  upsertForUser = async (userId: string, write: SandboxFileWrite) => {
    const now = new Date();
    await this.db
      .insert(sandboxProfileFiles)
      .values({
        content: write.encryptedContent,
        id: idGenerator('sandboxFiles'),
        mode: write.mode,
        path: write.path,
        profileId: write.profileId,
        sensitive: write.sensitive,
        size: write.size,
        updatedAt: now,
        updatedBy: write.updatedBy,
        userId,
      })
      .onConflictDoUpdate({
        set: {
          content: write.encryptedContent,
          mode: write.mode,
          sensitive: write.sensitive,
          size: write.size,
          updatedAt: now,
          updatedBy: write.updatedBy,
        },
        target: [
          sandboxProfileFiles.profileId,
          sandboxProfileFiles.userId,
          sandboxProfileFiles.path,
        ],
        targetWhere: sql`${sandboxProfileFiles.userId} is not null`,
      });
  };

  /** Changes a saved file's mode and Sensitive flag, keeping its content. */
  updateSettings = async (
    profileId: string,
    path: string,
    owner: Owner,
    change: { mode: number; sensitive: boolean; updatedBy: string },
  ): Promise<boolean> => {
    const rows = await this.db
      .update(sandboxProfileFiles)
      .set({ ...change, updatedAt: new Date() })
      .where(
        and(
          eq(sandboxProfileFiles.profileId, profileId),
          eq(sandboxProfileFiles.path, path),
          ownerFilter(owner),
        ),
      )
      .returning({ id: sandboxProfileFiles.id });
    return rows.length > 0;
  };

  delete = async (profileId: string, path: string, owner: Owner): Promise<boolean> => {
    const rows = await this.db
      .delete(sandboxProfileFiles)
      .where(
        and(
          eq(sandboxProfileFiles.profileId, profileId),
          eq(sandboxProfileFiles.path, path),
          ownerFilter(owner),
        ),
      )
      .returning({ id: sandboxProfileFiles.id });
    return rows.length > 0;
  };
}
