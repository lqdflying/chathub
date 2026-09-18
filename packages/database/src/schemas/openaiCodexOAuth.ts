/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Per-user ChatGPT / Codex subscription tokens.
 * Encrypted with KeyVaultsGateKeeper; never stored in ai_providers.key_vaults.
 */
export const openaiCodexOAuthTokens = pgTable('openai_codex_oauth_tokens', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  accountId: varchar('account_id', { length: 256 }).notNull(),
  email: varchar('email', { length: 256 }),
  chatgptPlanType: varchar('chatgpt_plan_type', { length: 64 }),
  clientId: varchar('client_id', { length: 256 }).notNull(),

  ...timestamps,
});

export const insertOpenAICodexOAuthTokenSchema = createInsertSchema(openaiCodexOAuthTokens);

export type OpenAICodexOAuthTokenItem = typeof openaiCodexOAuthTokens.$inferSelect;
export type NewOpenAICodexOAuthTokenItem = typeof openaiCodexOAuthTokens.$inferInsert;
