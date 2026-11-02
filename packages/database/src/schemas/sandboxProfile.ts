/* eslint-disable sort-keys-fix/sort-keys-fix */
import { boolean, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
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
