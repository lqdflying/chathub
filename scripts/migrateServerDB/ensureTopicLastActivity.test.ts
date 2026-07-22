import { describe, expect, it, vi } from 'vitest';

const {
  TOPIC_LAST_ACTIVITY_FINALIZE_SQL,
  TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL,
  TOPIC_LAST_ACTIVITY_SCHEMA_SQL,
  TOPIC_LAST_ACTIVITY_SQL,
  TOPIC_LAST_ACTIVITY_STATE_SQL,
  ensureTopicLastActivityColumn,
} = require('./ensureTopicLastActivity.cjs');

const completeState = {
  columnExists: true,
  hasNowDefault: true,
  isNotNull: true,
};

describe('ensureTopicLastActivityColumn', () => {
  it('returns after the catalog check when the schema is complete', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [completeState] }),
    };

    await ensureTopicLastActivityColumn(client);

    expect(client.query).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith(TOPIC_LAST_ACTIVITY_STATE_SQL);
  });

  it('runs the full repair when the column is missing', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, columnExists: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureTopicLastActivityColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, TOPIC_LAST_ACTIVITY_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, TOPIC_LAST_ACTIVITY_SQL);
  });

  it('runs the full repair when a partial column contains null rows', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, isNotNull: false }] })
        .mockResolvedValueOnce({ rows: [{ hasNullRows: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureTopicLastActivityColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, TOPIC_LAST_ACTIVITY_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL);
    expect(client.query).toHaveBeenNthCalledWith(3, TOPIC_LAST_ACTIVITY_SQL);
  });

  it('finalizes a populated partial schema without running the backfill', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, hasNowDefault: false }] })
        .mockResolvedValueOnce({ rows: [{ hasNullRows: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureTopicLastActivityColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, TOPIC_LAST_ACTIVITY_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, TOPIC_LAST_ACTIVITY_NULL_ROWS_SQL);
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      [TOPIC_LAST_ACTIVITY_SCHEMA_SQL, TOPIC_LAST_ACTIVITY_FINALIZE_SQL].join('\n'),
    );
    expect(client.query).not.toHaveBeenCalledWith(TOPIC_LAST_ACTIVITY_SQL);
  });
});
