/** @vitest-environment node */
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { conversationGenerationSteps } from '../../schemas';
import { ConversationGenerationModel } from '../conversationGeneration';

const createUpdateDb = () => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update }, returning, set, where };
};

const collectStrings = (node: unknown) => {
  const texts: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string') {
      texts.push(value);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const nested of Object.values(value)) walk(nested);
  };
  walk(node);
  return texts;
};

describe('ConversationGenerationModel compare-and-set guards', () => {
  it('clears workerJobId when a processing attempt is returned to pending', async () => {
    const { db, returning, set } = createUpdateDb();
    returning.mockResolvedValue([{ id: 'cgo_retry', status: 'pending' }]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await model.markForRetry(
      'cgo_retry',
      { message: 'upstream failed', type: 'GenerationError' },
      3,
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        workerJobId: null,
      }),
    );
  });

  it('returns undefined when a heartbeat no longer owns the processing row', async () => {
    const { db, returning } = createUpdateDb();
    returning.mockResolvedValue([]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await expect(model.touchHeartbeat('cgo_lost', 2)).resolves.toBeUndefined();
  });

  it('does not wipe a succeeded tool step on claim conflict', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const findFirst = vi.fn().mockResolvedValue({
      id: 'cgs_existing',
      status: 'succeeded',
    });
    const db = {
      insert,
      query: { conversationGenerationSteps: { findFirst } },
    };
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await expect(
      model.claimStep({
        attempt: 2,
        inputHash: 'hash-1',
        kind: 'tool:lobe-web-browsing:search',
        operationId: 'cgo_1',
      }),
    ).resolves.toMatchObject({ id: 'cgs_existing', status: 'succeeded' });

    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: 'processing' }),
        setWhere: sql`${conversationGenerationSteps.status} is distinct from 'succeeded' AND (${conversationGenerationSteps.status} is distinct from 'processing' OR ${conversationGenerationSteps.startedAt} < now() - interval '90 seconds')`,
      }),
    );
    expect(findFirst).toHaveBeenCalled();
  });

  it('does not finalize cancelling operations as succeeded', async () => {
    const { db, returning, where } = createUpdateDb();
    returning.mockResolvedValue([]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await expect(model.finalizeActive('cgo_cancelling', 'succeeded')).resolves.toBeUndefined();

    const texts = collectStrings(where.mock.calls[0]?.[0]);
    expect(texts).toEqual(expect.arrayContaining(['processing']));
    expect(texts).not.toContain('cancelling');
  });

  it('does not finalize pending recovery rows as interrupted', async () => {
    const { db, returning, where } = createUpdateDb();
    returning.mockResolvedValue([]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await expect(model.finalizeActive('cgo_pending', 'interrupted')).resolves.toBeUndefined();

    const texts = collectStrings(where.mock.calls[0]?.[0]);
    expect(texts).toEqual(expect.arrayContaining(['processing']));
    expect(texts).not.toContain('cancelling');
  });
});
