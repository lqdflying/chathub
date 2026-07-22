const CONVERSATION_VERSION_STATE_SQL = `
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'conversation_version'
  ) AS "columnExists",
  COALESCE((
    SELECT is_nullable = 'NO'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'conversation_version'
  ), false) AS "isNotNull",
  COALESCE((
    SELECT regexp_replace(column_default, '\\s+', '', 'g') = '0'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'conversation_version'
  ), false) AS "hasZeroDefault";
`;

const CONVERSATION_VERSION_NULL_ROWS_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM "users"
  WHERE "conversation_version" IS NULL
  LIMIT 1
) AS "hasNullRows";
`;

const CONVERSATION_VERSION_SCHEMA_SQL = `
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "conversation_version" integer;
`;

const CONVERSATION_VERSION_BACKFILL_SQL = `
UPDATE "users"
SET "conversation_version" = 0
WHERE "conversation_version" IS NULL;
`;

const CONVERSATION_VERSION_FINALIZE_SQL = `
ALTER TABLE "users"
  ALTER COLUMN "conversation_version" SET DEFAULT 0,
  ALTER COLUMN "conversation_version" SET NOT NULL;
`;

const CONVERSATION_VERSION_SQL = [
  CONVERSATION_VERSION_SCHEMA_SQL,
  CONVERSATION_VERSION_BACKFILL_SQL,
  CONVERSATION_VERSION_FINALIZE_SQL,
].join('\n');

const repairConversationVersionColumn = async (client, includeBackfill) => {
  await client.query(CONVERSATION_VERSION_SCHEMA_SQL);
  if (includeBackfill) {
    await client.query(CONVERSATION_VERSION_BACKFILL_SQL);
  }
  await client.query(CONVERSATION_VERSION_FINALIZE_SQL);
};

const ensureConversationVersionColumn = async (client) => {
  const stateResult = await client.query(CONVERSATION_VERSION_STATE_SQL);
  const state = stateResult.rows?.[0] || {};
  const schemaIsComplete = state.columnExists && state.isNotNull && state.hasZeroDefault;

  if (schemaIsComplete) return;

  console.log('[Database] Repairing users.conversation_version...');

  if (!state.columnExists) {
    await repairConversationVersionColumn(client, true);
    return;
  }

  const nullRowsResult = await client.query(CONVERSATION_VERSION_NULL_ROWS_SQL);
  const hasNullRows = nullRowsResult.rows?.[0]?.hasNullRows;

  if (hasNullRows) {
    await repairConversationVersionColumn(client, true);
    return;
  }

  await repairConversationVersionColumn(client, false);
};

module.exports = {
  CONVERSATION_VERSION_BACKFILL_SQL,
  CONVERSATION_VERSION_FINALIZE_SQL,
  CONVERSATION_VERSION_NULL_ROWS_SQL,
  CONVERSATION_VERSION_SCHEMA_SQL,
  CONVERSATION_VERSION_SQL,
  CONVERSATION_VERSION_STATE_SQL,
  ensureConversationVersionColumn,
};
