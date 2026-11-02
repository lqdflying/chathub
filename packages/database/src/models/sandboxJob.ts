import type { SandboxJobFile, SandboxJobStatus } from '@lobechat/types';
import { and, count, desc, eq } from 'drizzle-orm';

import { type SandboxJobRow, sandboxJobs } from '../schemas/sandboxJob';
import { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';

export interface CreateSandboxJobInput {
  command: string;
  commandId: string;
  cwd?: string;
  deadlineAt: Date;
  outputDir?: string;
  profileId: string;
  sessionKey: string;
  startedAt?: Date;
}

export interface FinishSandboxJobInput {
  error?: string;
  exitCode?: number;
  files?: SandboxJobFile[];
  finishedAt?: Date;
  outputTail?: string;
  status: Exclude<SandboxJobStatus, 'running'>;
}

/** Sandbox background jobs of one user. Only a running job can change. */
export class SandboxJobModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private own = (id: string) => and(eq(sandboxJobs.id, id), eq(sandboxJobs.userId, this.userId));

  create = async (input: CreateSandboxJobInput): Promise<SandboxJobRow> => {
    const [row] = await this.db
      .insert(sandboxJobs)
      .values({
        ...input,
        id: idGenerator('sandboxJobs'),
        startedAt: input.startedAt ?? new Date(),
        status: 'running',
        userId: this.userId,
      })
      .returning();
    return row;
  };

  find = async (id: string): Promise<SandboxJobRow | undefined> => {
    const [row] = await this.db.select().from(sandboxJobs).where(this.own(id)).limit(1);
    return row;
  };

  /** Jobs of one conversation sandbox, newest first. */
  listBySession = async (sessionKey: string, limit = 20): Promise<SandboxJobRow[]> =>
    this.db
      .select()
      .from(sandboxJobs)
      .where(and(eq(sandboxJobs.userId, this.userId), eq(sandboxJobs.sessionKey, sessionKey)))
      .orderBy(desc(sandboxJobs.startedAt))
      .limit(limit);

  /** All of this user's jobs, newest first. */
  listRecent = async (limit = 20): Promise<SandboxJobRow[]> =>
    this.db
      .select()
      .from(sandboxJobs)
      .where(eq(sandboxJobs.userId, this.userId))
      .orderBy(desc(sandboxJobs.startedAt))
      .limit(limit);

  countRunning = async (): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(sandboxJobs)
      .where(and(eq(sandboxJobs.userId, this.userId), eq(sandboxJobs.status, 'running')));
    return Number(row?.value ?? 0);
  };

  /** Records that the watcher reached the sandbox. No effect once the job ended. */
  markChecked = async (id: string, at = new Date()) => {
    await this.db
      .update(sandboxJobs)
      .set({ lastCheckedAt: at })
      .where(and(this.own(id), eq(sandboxJobs.status, 'running')));
  };

  /**
   * Ends a running job. Returns the saved row, or undefined when the job had
   * already ended, so the watcher, `getJobResult` and `cancelJob` cannot
   * overwrite each other's result.
   */
  finish = async (id: string, input: FinishSandboxJobInput): Promise<SandboxJobRow | undefined> => {
    const [row] = await this.db
      .update(sandboxJobs)
      .set({
        error: input.error ?? null,
        exitCode: input.exitCode ?? null,
        files: input.files ?? null,
        finishedAt: input.finishedAt ?? new Date(),
        outputTail: input.outputTail ?? null,
        status: input.status,
      })
      .where(and(this.own(id), eq(sandboxJobs.status, 'running')))
      .returning();
    return row;
  };
}
