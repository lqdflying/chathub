/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Per-user SuperGrok device-code tokens.
 * Encrypted with KeyVaultsGateKeeper; never stored in ai_providers.key_vaults.
 */
export const xaiOAuthTokens = pgTable('xai_oauth_tokens', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  email: varchar('email', { length: 256 }),
  plan: varchar('plan', { length: 64 }),
  tokenEndpoint: varchar('token_endpoint', { length: 512 }),
  clientId: varchar('client_id', { length: 256 }).notNull(),
  refreshLockId: varchar('refresh_lock_id', { length: 256 }),
  refreshLockUntil: timestamptz('refresh_lock_until'),

  ...timestamps,
});

export const insertXaiOAuthTokenSchema = createInsertSchema(xaiOAuthTokens);

export type XaiOAuthTokenItem = typeof xaiOAuthTokens.$inferSelect;
export type NewXaiOAuthTokenItem = typeof xaiOAuthTokens.$inferInsert;
