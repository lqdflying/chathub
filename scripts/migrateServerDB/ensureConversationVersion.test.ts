// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const {
  CONVERSATION_VERSION_SQL,
  ensureConversationVersionColumn,
} = require('./ensureConversationVersion.cjs');

describe('ensureConversationVersionColumn', () => {
  it('defines a non-null integer column with a zero default', () => {
    expect(CONVERSATION_VERSION_SQL).toContain(
      'ADD COLUMN IF NOT EXISTS "conversation_version" integer',
    );
    expect(CONVERSATION_VERSION_SQL).toContain('SET "conversation_version" = 0');
    expect(CONVERSATION_VERSION_SQL).toContain('ALTER COLUMN "conversation_version" SET DEFAULT 0');
    expect(CONVERSATION_VERSION_SQL).toContain('ALTER COLUMN "conversation_version" SET NOT NULL');
  });

  it('does not mutate a complete schema', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ columnExists: true, hasZeroDefault: true, isNotNull: true }],
    });

    await ensureConversationVersionColumn({ query });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('backfills a partial column before finalizing it', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ columnExists: true, hasZeroDefault: false, isNotNull: false }],
      })
      .mockResolvedValueOnce({ rows: [{ hasNullRows: true }] })
      .mockResolvedValue({ rows: [] });

    await ensureConversationVersionColumn({ query });

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('information_schema.columns'),
      expect.stringContaining('IS NULL'),
      expect.stringContaining('ADD COLUMN IF NOT EXISTS'),
      expect.stringContaining('SET "conversation_version" = 0'),
      expect.stringContaining('SET DEFAULT 0'),
    ]);
  });
});
