import { eq } from 'drizzle-orm';

import { sandboxProfileInstructions } from '../schemas/sandboxProfile';
import { LobeChatDatabase } from '../type';

export interface SavedSandboxInstruction {
  instruction: string;
  updatedAt: Date;
}

/**
 * Admin-edited Sandbox Hub instructions, shared by every user. Not scoped by
 * user: callers must check the admin list before writing.
 */
export class SandboxProfileInstructionModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  list = async (): Promise<Map<string, SavedSandboxInstruction>> => {
    const rows = await this.db
      .select({
        instruction: sandboxProfileInstructions.instruction,
        profileId: sandboxProfileInstructions.profileId,
        updatedAt: sandboxProfileInstructions.updatedAt,
      })
      .from(sandboxProfileInstructions);
    return new Map(
      rows.map((row) => [
        row.profileId,
        { instruction: row.instruction, updatedAt: row.updatedAt },
      ]),
    );
  };

  upsert = async (profileId: string, instruction: string, updatedBy: string) => {
    const now = new Date();
    await this.db
      .insert(sandboxProfileInstructions)
      .values({ instruction, profileId, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        set: { instruction, updatedAt: now, updatedBy },
        target: sandboxProfileInstructions.profileId,
      });
  };

  delete = async (profileId: string) => {
    await this.db
      .delete(sandboxProfileInstructions)
      .where(eq(sandboxProfileInstructions.profileId, profileId));
  };
}
