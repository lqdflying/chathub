const TOPIC_LAST_ACTIVITY_STATE_SQL = `
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'topics'
      AND column_name = 'last_activity_at'
  ) AS "columnExists",
  COALESCE((
    SELECT is_nullable = 'NO'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'topics'
      AND column_name = 'last_activity_at'
  ), false) AS "isNotNull",
  COALESCE((
    SELECT column_default IS NOT NULL
      AND regexp_replace(column_default, '\\s+', '', 'g') IN ('now()', 'CURRENT_TIMESTAMP')
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'topics'
      AND column_name = 'last_activity_at'
  ), false) AS "hasNowDefault";
`;

const TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM "topics"
  WHERE "last_activity_at" IS NULL
  LIMIT 1
) AS "hasNullRows";
`;

const TOPIC_LAST_ACTIVITY_SCHEMA_SQL = `
ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;
`;

const TOPIC_LAST_ACTIVITY_BACKFILL_SQL = `
UPDATE "topics" AS "topic"
SET "last_activity_at" = GREATEST(
  COALESCE("topic"."updated_at", "topic"."created_at"),
  COALESCE(
    (
      SELECT MAX("message"."created_at")
      FROM "messages" AS "message"
      WHERE "message"."topic_id" = "topic"."id"
    ),
    "topic"."created_at"
  )
)
WHERE "topic"."last_activity_at" IS NULL;
`;

const TOPIC_LAST_ACTIVITY_FINALIZE_SQL = `
ALTER TABLE "topics"
  ALTER COLUMN "last_activity_at" SET DEFAULT now(),
  ALTER COLUMN "last_activity_at" SET NOT NULL;
`;

const TOPIC_LAST_ACTIVITY_SQL = [
  TOPIC_LAST_ACTIVITY_SCHEMA_SQL,
  TOPIC_LAST_ACTIVITY_BACKFILL_SQL,
  TOPIC_LAST_ACTIVITY_FINALIZE_SQL,
].join('\n');

const ensureTopicLastActivityColumn = async (client) => {
  const stateResult = await client.query(TOPIC_LAST_ACTIVITY_STATE_SQL);
  const state = stateResult.rows?.[0] || {};
  const schemaIsComplete = state.columnExists && state.isNotNull && state.hasNowDefault;

  if (schemaIsComplete) return;

  console.log('[Database] Repairing topics.last_activity_at...');

  if (!state.columnExists) {
    await client.query(TOPIC_LAST_ACTIVITY_SQL);
    return;
  }

  const nullRowsResult = await client.query(TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL);
  const hasNullRows = nullRowsResult.rows?.[0]?.hasNullRows;

  if (hasNullRows) {
    await client.query(TOPIC_LAST_ACTIVITY_SQL);
    return;
  }

  await client.query([TOPIC_LAST_ACTIVITY_SCHEMA_SQL, TOPIC_LAST_ACTIVITY_FINALIZE_SQL].join('\n'));
};

module.exports = {
  TOPIC_LAST_ACTIVITY_BACKFILL_SQL,
  TOPIC_LAST_ACTIVITY_FINALIZE_SQL,
  TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL,
  TOPIC_LAST_ACTIVITY_SCHEMA_SQL,
  TOPIC_LAST_ACTIVITY_SQL,
  TOPIC_LAST_ACTIVITY_STATE_SQL,
  ensureTopicLastActivityColumn,
};
