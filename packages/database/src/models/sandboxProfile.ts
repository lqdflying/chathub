import { and, eq } from 'drizzle-orm';

import { userSandboxProfiles } from '../schemas/sandboxProfile';
import { LobeChatDatabase } from '../type';

/** A user's Sandbox Hub on/off choices, keyed by operator profile id. */
export class SandboxProfileModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /** Every user's choice for one profile; used when an admin deletes the profile. */
  static deleteForProfile = async (db: LobeChatDatabase, profileId: string) => {
    await db.delete(userSandboxProfiles).where(eq(userSandboxProfiles.profileId, profileId));
  };

  /** Explicit choices only; profiles without a row use their `defaultEnabled`. */
  list = async (): Promise<Map<string, boolean>> => {
    const rows = await this.db
      .select({ enabled: userSandboxProfiles.enabled, profileId: userSandboxProfiles.profileId })
      .from(userSandboxProfiles)
      .where(eq(userSandboxProfiles.userId, this.userId));
    return new Map(rows.map((row) => [row.profileId, row.enabled]));
  };

  find = async (profileId: string): Promise<boolean | undefined> => {
    const [row] = await this.db
      .select({ enabled: userSandboxProfiles.enabled })
      .from(userSandboxProfiles)
      .where(
        and(
          eq(userSandboxProfiles.userId, this.userId),
          eq(userSandboxProfiles.profileId, profileId),
        ),
      )
      .limit(1);
    return row?.enabled;
  };

  setEnabled = async (profileId: string, enabled: boolean) => {
    const now = new Date();
    await this.db
      .insert(userSandboxProfiles)
      .values({ enabled, profileId, updatedAt: now, userId: this.userId })
      .onConflictDoUpdate({
        set: { enabled, updatedAt: now },
        target: [userSandboxProfiles.userId, userSandboxProfiles.profileId],
      });
  };
}
