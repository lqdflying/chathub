/* eslint-disable sort-keys-fix/sort-keys-fix */
import { pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

/**
 * Per-user billing credentials (OpenAI / Anthropic admin keys, xAI management
 * key + team id) used only to read balance or spend. `credential` is
 * KeyVaultsGateKeeper ciphertext of a JSON object and never leaves the server;
 * it is deliberately not stored in ai_providers.key_vaults, which the browser
 * decrypts.
 */
export const providerUsageCredentials = pgTable(
  'provider_usage_credentials',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    credential: text('credential').notNull(),
    keyHint: varchar('key_hint', { length: 16 }).notNull(),
    accessedAt: timestamps.accessedAt,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.provider] }),
  }),
);

export type ProviderUsageCredentialItem = typeof providerUsageCredentials.$inferSelect;
export type NewProviderUsageCredentialItem = typeof providerUsageCredentials.$inferInsert;
