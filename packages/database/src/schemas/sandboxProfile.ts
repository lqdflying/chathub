/* eslint-disable sort-keys-fix/sort-keys-fix */
import type { SandboxImageStatus, SandboxProfileEgressSetting } from '@lobechat/types';
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

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

