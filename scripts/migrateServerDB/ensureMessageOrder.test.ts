import { describe, expect, it, vi } from 'vitest';

const {
  MESSAGE_ORDER_FINALIZE_SQL,
  MESSAGE_ORDER_NULL_ROWS_SQL,
  MESSAGE_ORDER_SCHEMA_SQL,
  MESSAGE_ORDER_SQL,
  MESSAGE_ORDER_STATE_SQL,
  ensureMessageOrderColumn,
} = require('./ensureMessageOrder.cjs');

const completeState = {
  columnExists: true,
  hasSequenceDefault: true,
  indexExists: true,
  isNotNull: true,
  sequenceExists: true,
};

describe('ensureMessageOrderColumn', () => {
  it('returns after the catalog check when the schema is complete', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [completeState] }),
    };

    await ensureMessageOrderColumn(client);

    expect(client.query).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith(MESSAGE_ORDER_STATE_SQL);
  });

  it('runs the full repair when the column is missing', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, columnExists: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureMessageOrderColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, MESSAGE_ORDER_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, MESSAGE_ORDER_SQL);
  });

  it('runs the full repair when the partial column contains null rows', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, isNotNull: false }] })
        .mockResolvedValueOnce({ rows: [{ hasNullRows: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureMessageOrderColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, MESSAGE_ORDER_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, MESSAGE_ORDER_NULL_ROWS_SQL);
    expect(client.query).toHaveBeenNthCalledWith(3, MESSAGE_ORDER_SQL);
  });

  it('finalizes a populated partial schema without running the recursive backfill', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ ...completeState, indexExists: false }] })
        .mockResolvedValueOnce({ rows: [{ hasNullRows: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await ensureMessageOrderColumn(client);

    expect(client.query).toHaveBeenNthCalledWith(1, MESSAGE_ORDER_STATE_SQL);
    expect(client.query).toHaveBeenNthCalledWith(2, MESSAGE_ORDER_NULL_ROWS_SQL);
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      [MESSAGE_ORDER_SCHEMA_SQL, MESSAGE_ORDER_FINALIZE_SQL].join('\n'),
    );
    expect(client.query).not.toHaveBeenCalledWith(MESSAGE_ORDER_SQL);
  });
});
