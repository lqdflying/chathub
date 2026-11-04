/* eslint-disable sort-keys-fix/sort-keys-fix */
import type { SandboxJobFile, SandboxJobStatus } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Sandbox background jobs (`startJob`): a detached command in a conversation's
 * sandbox, kept alive by the durable worker until it ends or reaches its
 * deadline. The result (exit code, output tail, kept files) stays here after
 * the sandbox is removed.
 */
export const sandboxJobs = pgTable(
  'sandbox_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: text('profile_id').notNull(),
    /** The conversation's sandbox key (`buildSandboxSessionKey`). */
    sessionKey: text('session_key').notNull(),
    /** execd command id inside the sandbox. */
    commandId: text('command_id').notNull(),
    command: text('command').notNull(),
    cwd: text('cwd'),
    outputDir: text('output_dir'),
    status: text('status').$type<SandboxJobStatus>().notNull(),
    exitCode: integer('exit_code'),
    error: text('error'),
    outputTail: text('output_tail'),
    files: jsonb('files').$type<SandboxJobFile[]>(),
    /**
     * KeyVaults ciphertext of the env map this job's sandbox was created
     * with. Null when there were no variables, or the job started before
     * snapshots. Used only to mask output; never returned to the client.
     */
    envSnapshot: text('env_snapshot'),
    /**
     * KeyVaults ciphertext of the sensitive-file mask this job's sandbox was
     * created with. Null when there were no files, or the job started before
     * snapshots. Used only to mask output; never returned to the client.
     */
    fileSnapshot: text('file_snapshot'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    deadlineAt: timestamptz('deadline_at').notNull(),
    finishedAt: timestamptz('finished_at'),
    /** Last time the watcher reached the sandbox. */
    lastCheckedAt: timestamptz('last_checked_at'),
    ...timestamps,
  },
  (table) => ({
    userSessionIdx: index('sandbox_jobs_user_session_idx').on(
      table.userId,
      table.sessionKey,
      table.startedAt,
    ),
    userStatusIdx: index('sandbox_jobs_user_status_idx').on(table.userId, table.status),
  }),
);

export type SandboxJobRow = typeof sandboxJobs.$inferSelect;
export type NewSandboxJobRow = typeof sandboxJobs.$inferInsert;
