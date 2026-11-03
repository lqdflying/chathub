import { and, count, eq, isNull, or, sql } from 'drizzle-orm';

import { type SandboxProfileEnvRow, sandboxProfileEnvs } from '../schemas/sandboxProfile';
import { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';

export interface SandboxEnvWrite {
  /** Already encrypted by the caller. */
  encryptedValue: string;
  hint: string | null;
  name: string;
  profileId: string;
  updatedBy: string;
}

/** Who owns a variable: everyone (shared) or one user. */
type Owner = { shared: true } | { userId: string };

const ownerFilter = (owner: Owner) =>
  'userId' in owner
    ? eq(sandboxProfileEnvs.userId, owner.userId)
    : isNull(sandboxProfileEnvs.userId);

/**
 * Sandbox Hub environment variables. Not scoped by user: callers check that a
 * shared write comes from an admin and a user's write from that user.
 */
export class SandboxProfileEnvModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /** Shared variables and this user's own, for every profile, by name. */
  listVisible = async (userId: string): Promise<SandboxProfileEnvRow[]> =>
    this.db
      .select()
      .from(sandboxProfileEnvs)
      .where(or(isNull(sandboxProfileEnvs.userId), eq(sandboxProfileEnvs.userId, userId)))
      .orderBy(sandboxProfileEnvs.profileId, sandboxProfileEnvs.name);

  /** What one user's sandbox of one profile gets: shared rows and the user's own. */
  listForSandbox = async (profileId: string, userId: string): Promise<SandboxProfileEnvRow[]> =>
    this.db
      .select()
      .from(sandboxProfileEnvs)
      .where(
        and(
          eq(sandboxProfileEnvs.profileId, profileId),
          or(isNull(sandboxProfileEnvs.userId), eq(sandboxProfileEnvs.userId, userId)),
        ),
      );

  count = async (profileId: string, owner: Owner): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(sandboxProfileEnvs)
      .where(and(eq(sandboxProfileEnvs.profileId, profileId), ownerFilter(owner)));
    return Number(row?.value ?? 0);
  };

  find = async (profileId: string, name: string, owner: Owner) => {
    const [row] = await this.db
      .select()
      .from(sandboxProfileEnvs)
      .where(
        and(
          eq(sandboxProfileEnvs.profileId, profileId),
          eq(sandboxProfileEnvs.name, name),
          ownerFilter(owner),
        ),
      )
      .limit(1);
    return row;
  };

  /** Adds or replaces a variable shared by every user of the profile. */
  upsertShared = async (write: SandboxEnvWrite) => {
    const now = new Date();
    await this.db
      .insert(sandboxProfileEnvs)
      .values({
        hint: write.hint,
        id: idGenerator('sandboxEnvs'),
        name: write.name,
        profileId: write.profileId,
        updatedAt: now,
        updatedBy: write.updatedBy,
        userId: null,
        value: write.encryptedValue,
      })
      .onConflictDoUpdate({
        set: {
          hint: write.hint,
          updatedAt: now,
          updatedBy: write.updatedBy,
          value: write.encryptedValue,
        },
        target: [sandboxProfileEnvs.profileId, sandboxProfileEnvs.name],
        targetWhere: sql`${sandboxProfileEnvs.userId} is null`,
      });
  };

  /** Adds or replaces one user's own variable for the profile. */
  upsertForUser = async (userId: string, write: SandboxEnvWrite) => {
    const now = new Date();
    await this.db
      .insert(sandboxProfileEnvs)
      .values({
        hint: write.hint,
        id: idGenerator('sandboxEnvs'),
        name: write.name,
        profileId: write.profileId,
        updatedAt: now,
        updatedBy: write.updatedBy,
        userId,
        value: write.encryptedValue,
      })
      .onConflictDoUpdate({
        set: {
          hint: write.hint,
          updatedAt: now,
          updatedBy: write.updatedBy,
          value: write.encryptedValue,
        },
        target: [sandboxProfileEnvs.profileId, sandboxProfileEnvs.userId, sandboxProfileEnvs.name],
        targetWhere: sql`${sandboxProfileEnvs.userId} is not null`,
      });
  };

  delete = async (profileId: string, name: string, owner: Owner): Promise<boolean> => {
    const rows = await this.db
      .delete(sandboxProfileEnvs)
      .where(
        and(
          eq(sandboxProfileEnvs.profileId, profileId),
          eq(sandboxProfileEnvs.name, name),
          ownerFilter(owner),
        ),
      )
      .returning({ id: sandboxProfileEnvs.id });
    return rows.length > 0;
  };
}
