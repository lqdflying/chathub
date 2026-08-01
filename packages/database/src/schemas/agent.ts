/* eslint-disable sort-keys-fix/sort-keys-fix  */
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { LobeAgentChatConfig, LobeAgentTTSConfig } from '@/types/agent';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { files, knowledgeBases } from './file';
import { users } from './user';

// Agent table is the main table for storing agents
// agent is a model that represents the assistant that is created by the user
// agent can have its own knowledge base and files

export const agents = pgTable(
  'agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agents'))
      .notNull(),
    slug: varchar('slug', { length: 100 })
      .$defaultFn(() => randomSlug(4))
      .unique(),
    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    tags: jsonb('tags').$type<string[]>().default([]),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),

    plugins: jsonb('plugins').$type<string[]>().default([]),

    clientId: text('client_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),

    fewShots: jsonb('few_shots'),
    model: text('model'),
    params: jsonb('params').default({}),
    provider: text('provider'),
    systemRole: text('system_role'),
    tts: jsonb('tts').$type<LobeAgentTTSConfig>(),

    virtual: boolean('virtual').default(false),

    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    /** Dynamic memory: auto-rolled-up cross-session notes for this assistant. */
    assistantMemory: text('assistant_memory'),
    /**
     * Rollup bookkeeping for `assistantMemory` (topic watermarks, undo backup, error/backoff).
     * Kept as an untyped jsonb (like `params`/`fewShots`) so drizzle-zod insert-schema
     * inference stays unchanged; app code types it via `AssistantMemoryMeta` on
     * `AgentItem`/`LobeAgentConfig` in `@lobechat/types`.
     */
    assistantMemoryMeta: jsonb('assistant_memory_meta'),
    /** Fixed memory: user-curated markdown doc, always injected, never auto-modified. */
    fixedMemory: text('fixed_memory'),

    ...timestamps,
  },
  (t) => ({
    agentIdUserIdUnique: uniqueIndex('agents_id_user_id_unique').on(t.id, t.userId),
    clientIdUnique: uniqueIndex('client_id_user_id_unique').on(t.clientId, t.userId),
    titleIndex: index('agents_title_idx').on(t.title),
    descriptionIndex: index('agents_description_idx').on(t.description),
  }),
);

export const insertAgentSchema = createInsertSchema(agents);

export type NewAgent = typeof agents.$inferInsert;
export type AgentItem = typeof agents.$inferSelect;

export const agentsKnowledgeBases = pgTable(
  'agents_knowledge_bases',
  {
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').default(true),

    ...timestamps,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.knowledgeBaseId] }),
  }),
);

export const agentsFiles = pgTable(
  'agents_files',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fileId, t.agentId, t.userId] }),
  }),
);
