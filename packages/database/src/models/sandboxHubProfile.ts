import type { SandboxImageStatus } from '@lobechat/types';
import { and, asc, count, eq, max } from 'drizzle-orm';

import {
  type NewSandboxHubProfileRow,
  type SandboxHubProfileRow,
  sandboxHubProfiles,
  sandboxProfileEnvs,
  sandboxProfileInstructions,
  userSandboxProfiles,
} from '../schemas/sandboxProfile';
import { LobeChatDatabase } from '../type';

/** The fields an admin edits; order, image status and audit columns are managed here. */
export type SandboxHubProfileSettings = Omit<
  NewSandboxHubProfileRow,
  | 'accessedAt'
  | 'createdAt'
  | 'imageCheckedAt'
  | 'imageCheckedRef'
  | 'imageStatus'
  | 'imageStatusMessage'
  | 'position'
  | 'updatedAt'
  | 'updatedBy'
>;

/**
 * Sandbox profiles managed in Sandbox Hub, shared by every user. Not scoped
 * by user: callers must check the admin list before writing.
 */
export class SandboxHubProfileModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /** In display, tool and prompt order. */
  list = async (): Promise<SandboxHubProfileRow[]> =>
    this.db
      .select()
      .from(sandboxHubProfiles)
      .orderBy(asc(sandboxHubProfiles.position), asc(sandboxHubProfiles.createdAt));

  find = async (id: string): Promise<SandboxHubProfileRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(sandboxHubProfiles)
      .where(eq(sandboxHubProfiles.id, id))
      .limit(1);
    return row;
  };

  count = async (): Promise<number> => {
    const [row] = await this.db.select({ value: count() }).from(sandboxHubProfiles);
    return Number(row?.value ?? 0);
  };

  /** Adds a profile after the existing ones. */
  create = async (
    settings: SandboxHubProfileSettings,
    updatedBy: string,
  ): Promise<SandboxHubProfileRow> => {
    const [last] = await this.db
      .select({ value: max(sandboxHubProfiles.position) })
      .from(sandboxHubProfiles);
    const [row] = await this.db
      .insert(sandboxHubProfiles)
      .values({ ...settings, position: (last?.value ?? -1) + 1, updatedBy })
      .returning();
    return row;
  };

  /**
   * Replaces a profile's settings. A changed image clears the image status,
   * which described the previous image.
   */
  update = async (
    id: string,
    settings: Omit<SandboxHubProfileSettings, 'id'>,
    updatedBy: string,
  ): Promise<SandboxHubProfileRow | undefined> => {
    const current = await this.find(id);
    if (!current) return undefined;
    const imageChanged = (settings.image ?? null) !== current.image;
    const [row] = await this.db
      .update(sandboxHubProfiles)
      .set({
        ...settings,
        ...(imageChanged
          ? {
              imageCheckedAt: null,
              imageCheckedRef: null,
              imageStatus: 'unknown' as const,
              imageStatusMessage: null,
            }
          : {}),
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(sandboxHubProfiles.id, id))
      .returning();
    return row;
  };

  /**
   * Removes the profile, its shared instruction edit, every user's on/off
   * choice, and its environment variables (shared and every user's) in one
   * transaction. A failure leaves all of them in place.
   */
  deleteWithRelated = async (id: string): Promise<void> => {
    await this.db.transaction(async (tx) => {
      await tx.delete(sandboxHubProfiles).where(eq(sandboxHubProfiles.id, id));
      await tx
        .delete(sandboxProfileInstructions)
        .where(eq(sandboxProfileInstructions.profileId, id));
      await tx.delete(userSandboxProfiles).where(eq(userSandboxProfiles.profileId, id));
      await tx.delete(sandboxProfileEnvs).where(eq(sandboxProfileEnvs.profileId, id));
    });
  };

  /**
   * Inserts profiles that do not exist yet, in the order given. Concurrent
   * seeds from several server processes insert each profile once.
   */
  seed = async (rows: SandboxHubProfileSettings[]): Promise<number> => {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(sandboxHubProfiles)
      .values(rows.map((row, position) => ({ ...row, position })))
      .onConflictDoNothing({ target: sandboxHubProfiles.id })
      .returning({ id: sandboxHubProfiles.id });
    return inserted.length;
  };

  /** Moves a profile one place up or down; no effect at either end. */
  move = async (id: string, direction: 'down' | 'up'): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: sandboxHubProfiles.id })
        .from(sandboxHubProfiles)
        .orderBy(asc(sandboxHubProfiles.position), asc(sandboxHubProfiles.createdAt));
      const index = rows.findIndex((row) => row.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= rows.length) return false;
      const order = rows.map((row) => row.id);
      [order[index], order[target]] = [order[target], order[index]];
      for (const [position, rowId] of order.entries()) {
        await tx
          .update(sandboxHubProfiles)
          .set({ position })
          .where(eq(sandboxHubProfiles.id, rowId));
      }
      return true;
    });

  /**
   * Records a Prepare image result for the image named in `ref`.
   * Returns the stored `imageCheckedAt`, or undefined when `expectedCheckedAt`
   * is set and this run is no longer the current preparing run.
   * A missing `expectedCheckedAt` always writes. `startSandboxImagePreparation`
   * uses that to start a run and get its token.
   */
  setImageStatus = async (
    id: string,
    { message, ref, status }: { message?: string; ref: string; status: SandboxImageStatus },
    expectedCheckedAt?: Date,
  ): Promise<Date | undefined> => {
    const [row] = await this.db
      .update(sandboxHubProfiles)
      .set({
        imageCheckedAt: new Date(),
        imageCheckedRef: ref,
        imageStatus: status,
        imageStatusMessage: message ?? null,
      })
      .where(
        expectedCheckedAt
          ? and(
              eq(sandboxHubProfiles.id, id),
              eq(sandboxHubProfiles.imageStatus, 'preparing'),
              eq(sandboxHubProfiles.imageCheckedRef, ref),
              eq(sandboxHubProfiles.imageCheckedAt, expectedCheckedAt),
            )
          : eq(sandboxHubProfiles.id, id),
      )
      .returning({ imageCheckedAt: sandboxHubProfiles.imageCheckedAt });
    return row?.imageCheckedAt ?? undefined;
  };
}
