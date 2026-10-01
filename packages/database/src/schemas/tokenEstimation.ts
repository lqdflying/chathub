/* eslint-disable sort-keys-fix/sort-keys-fix */
import { integer, pgTable, primaryKey, real, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

/**
 * Per-user, per-model token-estimate correction. Numeric state only.
 * A revision bump starts a new row so an old ratio is not applied to a new counter.
 */
export const tokenEstimationProfiles = pgTable(
  'token_estimation_profiles',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    estimatorRevision: integer('estimator_revision').notNull(),
    samples: integer('samples').default(0).notNull(),
    ewma: real('ewma').notNull(),
    accessedAt: timestamps.accessedAt,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.userId, table.provider, table.model, table.estimatorRevision],
    }),
  }),
);

export type TokenEstimationProfileItem = typeof tokenEstimationProfiles.$inferSelect;
export type NewTokenEstimationProfileItem = typeof tokenEstimationProfiles.$inferInsert;
