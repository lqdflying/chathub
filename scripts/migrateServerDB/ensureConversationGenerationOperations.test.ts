// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const {
  CONVERSATION_GENERATION_SQL,
  ensureConversationGenerationOperations,
} = require('./ensureConversationGenerationOperations.cjs');

describe('ensureConversationGenerationOperations', () => {
  it('inspects and repairs the legacy active-lane predicate', () => {
    expect(CONVERSATION_GENERATION_SQL).toContain(
      'pg_get_expr(index_data.indpred, index_data.indrelid)',
    );
    expect(CONVERSATION_GENERATION_SQL).toContain(
      "to_regclass('public.conversation_generation_operations_lane_active_uniq')",
    );
    expect(CONVERSATION_GENERATION_SQL).toContain('AND index_data.indisunique');
    expect(CONVERSATION_GENERATION_SQL).toContain('AND index_data.indisvalid');
    expect(CONVERSATION_GENERATION_SQL).toContain('AND index_data.indnkeyatts = 1');
    expect(CONVERSATION_GENERATION_SQL).toContain(
      "'cancelling' in pg_get_expr(index_data.indpred, index_data.indrelid)",
    );
    expect(CONVERSATION_GENERATION_SQL).toContain(
      'DROP INDEX IF EXISTS "conversation_generation_operations_lane_active_uniq"',
    );
    expect(CONVERSATION_GENERATION_SQL).toContain(`WHERE "status" in ('pending', 'processing')`);
    expect(CONVERSATION_GENERATION_SQL).not.toContain(
      `WHERE "status" in ('pending', 'processing', 'cancelling')`,
    );
  });

  it('deduplicates old tool steps before adding the replay uniqueness constraint', () => {
    expect(CONVERSATION_GENERATION_SQL).toContain('WITH ranked_steps AS');
    expect(CONVERSATION_GENERATION_SQL).toContain('PARTITION BY "operation_id", "input_hash"');
    expect(CONVERSATION_GENERATION_SQL).toContain('AND index_data.indnkeyatts = 2');
    expect(CONVERSATION_GENERATION_SQL).toContain('AND index_data.indpred IS NULL');
    expect(CONVERSATION_GENERATION_SQL).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_steps_input_hash_uniq"',
    );
    expect(CONVERSATION_GENERATION_SQL).toContain(
      'DROP INDEX IF EXISTS "conversation_generation_steps_input_hash_idx"',
    );
  });

  it('keeps the journal migration aligned with the startup repair contract', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'packages/database/migrations/0056_harden_conversation_generation_indexes.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'DROP INDEX IF EXISTS "conversation_generation_operations_lane_active_uniq"',
    );
    expect(migration).toContain(`WHERE "status" in ('pending', 'processing')`);
    expect(migration).toContain('PARTITION BY "operation_id", "input_hash"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "conversation_generation_steps_input_hash_uniq"',
    );
  });

  it('adds the placeholder cleanup column and partial index for unmarked terminal jobs', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'packages/database/migrations/0057_conversation_generation_placeholder_cleanup.sql',
      ),
      'utf8',
    );
    const journal = readFileSync(
      resolve(process.cwd(), 'packages/database/migrations/meta/_journal.json'),
      'utf8',
    );

    expect(journal).toContain('0057_conversation_generation_placeholder_cleanup');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "placeholders_cleaned_at"');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "conversation_generation_operations_placeholder_cleanup_idx"',
    );
    expect(migration).toContain('WHERE "placeholders_cleaned_at" IS NULL');
    expect(CONVERSATION_GENERATION_SQL).toContain('"placeholders_cleaned_at" timestamp with time zone');
    expect(CONVERSATION_GENERATION_SQL).toContain(
      'CREATE INDEX IF NOT EXISTS "conversation_generation_operations_placeholder_cleanup_idx"',
    );
    expect(CONVERSATION_GENERATION_SQL).toContain(
      `AND "status" IN ('cancelled', 'failed', 'interrupted', 'succeeded')`,
    );
  });

  it('runs the complete repair as one database request', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await ensureConversationGenerationOperations({ query });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(CONVERSATION_GENERATION_SQL);
  });
});
