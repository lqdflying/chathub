/* eslint-disable sort-keys-fix/sort-keys-fix */
import type { SandboxImageStatus, SandboxProfileEgressSetting } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Sandbox Hub: a user's explicit on/off choice for an operator-defined sandbox
 * profile (`SANDBOX_PROFILES_FILE`). A row exists only after a toggle; with no
 * row the profile's `defaultEnabled` applies. Profiles themselves live in the
 * operator config, not in the database.
 */
export const userSandboxProfiles = pgTable(
  'user_sandbox_profiles',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: text('profile_id').notNull(),
    enabled: boolean('enabled').notNull(),
    accessedAt: timestamps.accessedAt,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.profileId] }),
  }),
);

export type UserSandboxProfileItem = typeof userSandboxProfiles.$inferSelect;
export type NewUserSandboxProfileItem = typeof userSandboxProfiles.$inferInsert;

/**
 * Sandbox Hub: an admin-edited model instruction for a profile, shared by every
 * user. A row exists only after an edit; without one the profile's starting
 * instruction (the profiles file, or the built-in Sandbox text for `general`)
 * applies. Reset deletes the row.
 */
export const sandboxProfileInstructions = pgTable('sandbox_profile_instructions', {
  profileId: text('profile_id').primaryKey(),
  instruction: text('instruction').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  accessedAt: timestamps.accessedAt,
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
});

export type SandboxProfileInstructionItem = typeof sandboxProfileInstructions.$inferSelect;
export type NewSandboxProfileInstructionItem = typeof sandboxProfileInstructions.$inferInsert;

/**
 * Sandbox Hub: the sandbox profiles admins manage in the Hub, shared by every
 * user. Seeded once from SANDBOX_PROFILES_FILE (or OPENSANDBOX_*) when empty;
 * from then on the Hub owns them. Servers stay in the file, so no API key is
 * stored here. A null setting inherits its OPENSANDBOX_* default, as an
 * omitted field does in the file.
 */
export const sandboxHubProfiles = pgTable('sandbox_hub_profiles', {
  id: text('id').primaryKey(),
  position: integer('position').notNull().default(0),
  name: text('name').notNull(),
  description: text('description').notNull(),
  avatar: text('avatar'),
  serverId: text('server_id').notNull(),
  image: text('image'),
  cpu: text('cpu'),
  memory: text('memory'),
  egress: jsonb('egress').$type<SandboxProfileEgressSetting>(),
  readyTimeoutMs: bigint('ready_timeout_ms', { mode: 'number' }),
  sessionIdleTimeoutMs: bigint('session_idle_timeout_ms', { mode: 'number' }),
  sessionMaxLifetimeMs: bigint('session_max_lifetime_ms', { mode: 'number' }),
  jobMaxRuntimeMs: bigint('job_max_runtime_ms', { mode: 'number' }),
  defaultEnabled: boolean('default_enabled').notNull().default(false),
  instructionBase: text('instruction_base').$type<'general' | 'none'>().notNull().default('general'),
  instructionText: text('instruction_text'),
  imageStatus: text('image_status').$type<SandboxImageStatus>().notNull().default('unknown'),
  imageStatusMessage: text('image_status_message'),
  /** The image the status refers to; a different current image means unknown. */
  imageCheckedRef: text('image_checked_ref'),
  imageCheckedAt: timestamptz('image_checked_at'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  accessedAt: timestamps.accessedAt,
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
});

export type SandboxHubProfileRow = typeof sandboxHubProfiles.$inferSelect;
export type NewSandboxHubProfileRow = typeof sandboxHubProfiles.$inferInsert;

/**
 * Sandbox Hub: secret environment variables sent to a profile's sandboxes when
 * they are created. A row without `user_id` is shared by every user of the
 * profile (set by admins); a row with one belongs to that user and overrides
 * a shared variable of the same name in their sandboxes only. `value` is
 * KeyVaultsGateKeeper ciphertext and never leaves the server.
 */
export const sandboxProfileEnvs = pgTable(
  'sandbox_profile_envs',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: text('value').notNull(),
    /** `••••` and the last 4 characters of a long value; never more. */
    hint: text('hint'),
    /** When true, the Hub and command output hide the value. Existing rows stay hidden. */
    sensitive: boolean('sensitive').default(true).notNull(),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    accessedAt: timestamps.accessedAt,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => [
    uniqueIndex('sandbox_profile_envs_shared_uniq')
      .on(table.profileId, table.name)
      .where(sql`${table.userId} is null`),
    uniqueIndex('sandbox_profile_envs_user_uniq')
      .on(table.profileId, table.userId, table.name)
      .where(sql`${table.userId} is not null`),
    index('sandbox_profile_envs_user_idx').on(table.userId),
  ],
);

export type SandboxProfileEnvRow = typeof sandboxProfileEnvs.$inferSelect;

/**
 * Sandbox Hub: secret files written into a profile's sandboxes right after
 * they are created. A row without `user_id` is shared by every user of the
 * profile (set by admins); a row with one belongs to that user and replaces a
 * shared file at the same path in their sandboxes only. `content` is
 * KeyVaultsGateKeeper ciphertext of the file's bytes in base64.
 */
export const sandboxProfileFiles = pgTable(
  'sandbox_profile_files',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Absolute path in the sandbox. */
    path: text('path').notNull(),
    /** Permission bits, octal written as decimal (600 = rw-------), as execd takes them. */
    mode: integer('mode').notNull(),
    content: text('content').notNull(),
    /** Size of the file in bytes. */
    size: integer('size').notNull(),
    /** When true, the Hub never shows the content and command output hides it. */
    sensitive: boolean('sensitive').default(true).notNull(),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    accessedAt: timestamps.accessedAt,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => [
    uniqueIndex('sandbox_profile_files_shared_uniq')
      .on(table.profileId, table.path)
      .where(sql`${table.userId} is null`),
    uniqueIndex('sandbox_profile_files_user_uniq')
      .on(table.profileId, table.userId, table.path)
      .where(sql`${table.userId} is not null`),
    index('sandbox_profile_files_user_idx').on(table.userId),
  ],
);

export type SandboxProfileFileRow = typeof sandboxProfileFiles.$inferSelect;

