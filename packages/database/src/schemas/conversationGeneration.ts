/* eslint-disable sort-keys-fix/sort-keys-fix */
import type {
  ConversationGenerationConfigSnapshot,
  ConversationGenerationError,
  ConversationGenerationEventType,
  ConversationGenerationKind,
  ConversationGenerationPhase,
  ConversationGenerationStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from './_helpers';
import { users } from './user';

export const conversationGenerationOperations = pgTable(
  'conversation_generation_operations',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('conversationGenerationOperations'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    kind: varchar255('kind').$type<ConversationGenerationKind>().notNull(),
    status: varchar255('status').$type<ConversationGenerationStatus>().notNull().default('pending'),
    phase: varchar255('phase').$type<ConversationGenerationPhase>(),
    lane: text('lane').notNull(),

    sessionId: text('session_id'),
    topicId: text('topic_id'),
    threadId: text('thread_id'),
    groupId: text('group_id'),
    agentId: text('agent_id'),

    userMessageId: text('user_message_id'),
    assistantMessageId: text('assistant_message_id'),
    parentMessageId: text('parent_message_id'),

    idempotencyKey: varchar255('idempotency_key'),
    config: jsonb('config').$type<ConversationGenerationConfigSnapshot>().notNull(),
    error: jsonb('error').$type<ConversationGenerationError | null>(),

    revision: integer('revision').notNull().default(0),
    attempt: integer('attempt').notNull().default(0),
    laneGeneration: integer('lane_generation').notNull().default(1),
    conversationVersion: integer('conversation_version'),
    workerJobId: text('worker_job_id'),

    heartbeatAt: timestamptz('heartbeat_at'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    placeholdersCleanedAt: timestamptz('placeholders_cleaned_at'),
    cancelRequestedAt: timestamptz('cancel_requested_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('conversation_generation_operations_lane_active_uniq')
      .on(t.lane)
      .where(sql`${t.status} in ('pending', 'processing')`),
    index('conversation_generation_operations_pending_no_job_idx')
      .on(t.status)
      .where(sql`${t.status} = 'pending' and ${t.workerJobId} is null`),
    index('conversation_generation_operations_stale_processing_idx')
      .on(t.status, t.heartbeatAt)
      .where(sql`${t.status} = 'processing'`),
    uniqueIndex('conversation_generation_operations_idempotency_uniq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('conversation_generation_operations_user_created_idx').on(t.userId, t.createdAt),
    index('conversation_generation_operations_user_status_idx').on(t.userId, t.status),
    index('conversation_generation_operations_placeholder_cleanup_idx')
      .on(t.finishedAt, t.id)
      .where(
        sql`${t.placeholdersCleanedAt} is null and ${t.finishedAt} is not null and ${t.status} in ('cancelled', 'failed', 'interrupted', 'succeeded')`,
      ),
  ],
);

export const conversationGenerationSteps = pgTable(
  'conversation_generation_steps',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('conversationGenerationSteps'))
      .primaryKey(),

    operationId: text('operation_id')
      .references(() => conversationGenerationOperations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    kind: varchar255('kind').notNull(),
    status: varchar255('status').notNull(),
    attempt: integer('attempt').notNull().default(0),
    inputHash: text('input_hash'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    error: jsonb('error').$type<ConversationGenerationError | null>(),

    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),

    ...timestamps,
  },
  (t) => [
    index('conversation_generation_steps_operation_idx').on(t.operationId, t.createdAt),
    uniqueIndex('conversation_generation_steps_input_hash_uniq').on(t.operationId, t.inputHash),
  ],
);

export const conversationGenerationEvents = pgTable(
  'conversation_generation_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    operationId: text('operation_id')
      .references(() => conversationGenerationOperations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar255('type').$type<ConversationGenerationEventType>().notNull(),
    revision: integer('revision').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('conversation_generation_events_user_id_idx').on(t.userId, t.id),
    index('conversation_generation_events_operation_idx').on(t.operationId, t.id),
  ],
);

export type ConversationGenerationOperationItem =
  typeof conversationGenerationOperations.$inferSelect;
export type NewConversationGenerationOperation =
  typeof conversationGenerationOperations.$inferInsert;
export type ConversationGenerationStepItem = typeof conversationGenerationSteps.$inferSelect;
export type ConversationGenerationEventItem = typeof conversationGenerationEvents.$inferSelect;
