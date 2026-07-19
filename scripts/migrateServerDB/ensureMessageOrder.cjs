/**
 * Idempotent repair for the private messages.message_order column.
 * Healthy schemas return after a catalog-only check. Expensive row repair runs
 * only when the column is missing or contains null values.
 */
const MESSAGE_ORDER_STATE_SQL = `
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'message_order'
  ) AS "columnExists",
  COALESCE((
    SELECT is_nullable = 'NO'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'message_order'
  ), false) AS "isNotNull",
  COALESCE((
    SELECT column_default LIKE '%messages_message_order_seq%'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'message_order'
  ), false) AS "hasSequenceDefault",
  to_regclass('public.messages_message_order_seq') IS NOT NULL AS "sequenceExists",
  to_regclass('public.messages_created_at_order_idx') IS NOT NULL AS "indexExists";
`;

const MESSAGE_ORDER_NULL_ROWS_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM "messages"
  WHERE "message_order" IS NULL
  LIMIT 1
) AS "hasNullRows";
`;

const MESSAGE_ORDER_SCHEMA_SQL = `
CREATE SEQUENCE IF NOT EXISTS "public"."messages_message_order_seq"
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 9223372036854775807
  START WITH 1
  CACHE 1;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "message_order" bigint;
ALTER SEQUENCE "public"."messages_message_order_seq" OWNED BY "messages"."message_order";
`;

const MESSAGE_ORDER_BACKFILL_SQL = `
WITH RECURSIVE "source_messages" AS MATERIALIZED (
  SELECT
		"message"."id",
		"message"."parent_id",
		"message"."created_at",
		"message"."message_order",
    row_number() OVER (
      ORDER BY
        "message"."created_at",
        "message"."message_order" NULLS LAST,
        "message".ctid
    )::bigint AS "source_order"
  FROM "messages" AS "message"
),
"message_tree" AS (
  SELECT
    "message"."id",
    "message"."created_at",
    ARRAY["message"."source_order"]::bigint[] AS "causal_path",
    ARRAY["message"."id"]::text[] AS "visited_ids"
  FROM "source_messages" AS "message"
  LEFT JOIN "source_messages" AS "same_timestamp_parent"
    ON "same_timestamp_parent"."id" = "message"."parent_id"
    AND "same_timestamp_parent"."created_at" = "message"."created_at"
  WHERE "same_timestamp_parent"."id" IS NULL

  UNION ALL

  SELECT
    "child"."id",
    "child"."created_at",
    "message_tree"."causal_path" || "child"."source_order",
    "message_tree"."visited_ids" || "child"."id"
  FROM "message_tree"
  INNER JOIN "source_messages" AS "child"
    ON "child"."parent_id" = "message_tree"."id"
    AND "child"."created_at" = "message_tree"."created_at"
  WHERE NOT "child"."id" = ANY("message_tree"."visited_ids")
),
"ranked_messages" AS (
  SELECT
    "message"."id",
		row_number() OVER (
			ORDER BY
				"message"."created_at",
				CASE WHEN "message_tree"."id" IS NULL THEN 1 ELSE 0 END,
				COALESCE(
					"message_tree"."causal_path",
					ARRAY["message"."source_order"]::bigint[]
				)
		) AS "message_order"
  FROM "source_messages" AS "message"
  LEFT JOIN "message_tree" ON "message_tree"."id" = "message"."id"
)
UPDATE "messages" AS "message"
SET "message_order" = "ranked_messages"."message_order"
FROM "ranked_messages"
WHERE "message"."id" = "ranked_messages"."id";
`;

const MESSAGE_ORDER_FINALIZE_SQL = `
SELECT setval(
  '"public"."messages_message_order_seq"',
  COALESCE((SELECT max("message_order") FROM "messages"), 0) + 1,
  false
);

ALTER TABLE "messages"
  ALTER COLUMN "message_order" SET DEFAULT nextval('messages_message_order_seq'::regclass);
ALTER TABLE "messages" ALTER COLUMN "message_order" SET NOT NULL;

DROP INDEX IF EXISTS "messages_created_at_idx";
CREATE INDEX IF NOT EXISTS "messages_created_at_order_idx"
  ON "messages" USING btree ("created_at", "message_order");
`;

const MESSAGE_ORDER_SQL = [
  MESSAGE_ORDER_SCHEMA_SQL,
  MESSAGE_ORDER_BACKFILL_SQL,
  MESSAGE_ORDER_FINALIZE_SQL,
].join('\n');

/**
 * @param {{ query: (sql: string) => Promise<{ rows?: Record<string, unknown>[] }> }} client
 * node-pg Pool or compatible
 */
const ensureMessageOrderColumn = async (client) => {
  const stateResult = await client.query(MESSAGE_ORDER_STATE_SQL);
  const state = stateResult.rows?.[0] || {};
  const schemaIsComplete =
    state.columnExists &&
    state.isNotNull &&
    state.hasSequenceDefault &&
    state.sequenceExists &&
    state.indexExists;

  if (schemaIsComplete) return;

  if (!state.columnExists) {
    await client.query(MESSAGE_ORDER_SQL);
    return;
  }

  const nullRowsResult = await client.query(MESSAGE_ORDER_NULL_ROWS_SQL);
  const hasNullRows = nullRowsResult.rows?.[0]?.hasNullRows;

  if (hasNullRows) {
    await client.query(MESSAGE_ORDER_SQL);
    return;
  }

  await client.query([MESSAGE_ORDER_SCHEMA_SQL, MESSAGE_ORDER_FINALIZE_SQL].join('\n'));
};

module.exports = {
  MESSAGE_ORDER_BACKFILL_SQL,
  MESSAGE_ORDER_FINALIZE_SQL,
  MESSAGE_ORDER_NULL_ROWS_SQL,
  MESSAGE_ORDER_SCHEMA_SQL,
  MESSAGE_ORDER_SQL,
  MESSAGE_ORDER_STATE_SQL,
  ensureMessageOrderColumn,
};
