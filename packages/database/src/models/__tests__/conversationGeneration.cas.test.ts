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

  it('appends supervisor child ids with a jsonb set expression instead of replacing config', async () => {
    const { db, returning, set, where } = createUpdateDb();
    returning.mockResolvedValue([
      { config: { supervisorChildMessageIds: ['child-1'] }, id: 'cgo-1' },
    ]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await model.appendSupervisorChildMessageId('cgo-1', 'child-1', {
      attempt: 1,
      laneGeneration: 1,
    });

    const setTexts = collectStrings(set.mock.calls[0]?.[0]);
    expect(setTexts.join('\n')).toContain('jsonb_set');
    expect(setTexts.join('\n')).toContain('jsonb_build_array');
    expect(setTexts.join('\n')).toContain('jsonb_exists');
    expect(setTexts.join('\n')).toContain('supervisorChildMessageIds');
    const whereTexts = collectStrings(where.mock.calls[0]?.[0]);
    expect(whereTexts).toEqual(expect.arrayContaining(['pending', 'processing', 'cancelling']));
  });

  it('marks placeholder cleanup without rewriting active rows', async () => {
    const { db, returning, set, where } = createUpdateDb();
    returning.mockResolvedValue([{ id: 'cgo-1' }]);
    const model = new ConversationGenerationModel(db as any, 'user-1');

    await model.markPlaceholdersCleaned('cgo-1');

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        placeholdersCleanedAt: expect.any(Date),
      }),
    );
    const whereTexts = collectStrings(where.mock.calls[0]?.[0]);
    expect(whereTexts).toEqual(
      expect.arrayContaining(['cancelled', 'failed', 'interrupted', 'succeeded']),
    );
    expect(whereTexts).not.toEqual(expect.arrayContaining(['pending', 'processing']));
  });

  it('lists unmarked finished operations oldest-first with a finishedAt/id keyset', async () => {
    const forUpdate = vi.fn().mockResolvedValue([]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const model = new ConversationGenerationModel({ select } as any, 'system');
    const after = { finishedAt: new Date('2026-08-01T00:00:00.000Z'), id: 'cgo_99' };

    await model.listUncleanedFinished({ after, limit: 50 });

    expect(select).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(50);
    expect(forUpdate).toHaveBeenCalledWith('update', { skipLocked: true });
    const whereTexts = collectStrings(where.mock.calls[0]?.[0]);
    expect(whereTexts).toEqual(
      expect.arrayContaining(['cancelled', 'failed', 'interrupted', 'succeeded']),
    );
    expect(whereTexts.join('\n')).toContain('cgo_99');
    const orderTexts = collectStrings(orderBy.mock.calls[0]?.[0]);
    expect(orderTexts.join('\n')).toContain('finished_at');
    expect(orderTexts.join('\n')).toContain('id');
  });
});
