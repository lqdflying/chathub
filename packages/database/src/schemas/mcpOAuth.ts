/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export const mcpOAuthTokens = pgTable('mcp_oauth_tokens', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  pluginIdentifier: varchar('plugin_identifier', { length: 256 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenType: varchar('token_type', { length: 64 }).default('Bearer'),
  expiresAt: timestamptz('expires_at'),
  scope: text('scope'),
  clientId: varchar('client_id', { length: 256 }).notNull(),
  serverMetadata: jsonb('server_metadata').$type<{
    authorization_endpoint?: string;
    client_secret?: string;
    registration_endpoint?: string;
    token_endpoint?: string;
  }>(),

  ...timestamps,
});

export const insertMcpOAuthTokenSchema = createInsertSchema(mcpOAuthTokens);

export type McpOAuthTokenItem = typeof mcpOAuthTokens.$inferSelect;
export type NewMcpOAuthTokenItem = typeof mcpOAuthTokens.$inferInsert;
