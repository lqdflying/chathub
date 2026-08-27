import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as generationDebugClient from '@/libs/logger/generationDebugClient';

import {
  EVENT_DROP_ATTACH_RACE_MS,
  EVENT_DROP_SUMMARY_FLUSH_AT,
  flushEventDropSummary,
  logEventDropped,
  noteConversationGenerationAttached,
  resetEventDroppedDebugState,
} from '../eventDroppedDebug';

describe('eventDroppedDebug', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const droppedCalls = () =>
    logSpy.mock.calls.filter(([event]) => event === 'event_dropped') as Array<
      [string, Record<string, unknown>]
    >;
  const summaryCalls = () =>
    logSpy.mock.calls.filter(([event]) => event === 'event_drop_summary') as Array<
      [string, Record<string, unknown>]
    >;

  beforeEach(() => {
    resetEventDroppedDebugState();
    logSpy = vi
      .spyOn(generationDebugClient, 'logGenerationDebugClientSafe')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetEventDroppedDebugState();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('suppresses never-attached done after the attach-race window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    logEventDropped('cgo_foreign', 'not_attached', 'done');
    expect(droppedCalls()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(EVENT_DROP_ATTACH_RACE_MS);
    expect(droppedCalls()).toHaveLength(0);

    flushEventDropSummary();
    expect(summaryCalls()).toEqual([
      [
        'event_drop_summary',
        {
          distinctOps: 1,
          emittedCount: 0,
          notAttachedCount: 1,
          notAttachedDone: 1,
          notAttachedError: 0,
          notAttachedSnapshot: 0,
          notAttachedStatus: 0,
          staleRevisionCount: 0,
          suppressedCount: 1,
        },
      ],
    ]);
  });

  it('flushes a summary once suppressed drops reach the batch size', () => {
    for (let index = 0; index < EVENT_DROP_SUMMARY_FLUSH_AT; index += 1) {
      logEventDropped(`cgo_replay_${index}`, 'not_attached', 'status');
    }

    expect(droppedCalls()).toHaveLength(0);
    expect(summaryCalls()).toHaveLength(1);
    expect(summaryCalls()[0][1]).toMatchObject({
      distinctOps: EVENT_DROP_SUMMARY_FLUSH_AT,
      notAttachedStatus: EVENT_DROP_SUMMARY_FLUSH_AT,
      suppressedCount: EVENT_DROP_SUMMARY_FLUSH_AT,
    });
  });

  it('counts mixed suppressed types in one summary', () => {
    logEventDropped('cgo_a', 'not_attached', 'snapshot');
    logEventDropped('cgo_b', 'not_attached', 'status');
    logEventDropped('cgo_c', 'not_attached', 'error');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    logEventDropped('cgo_c', 'not_attached', 'error');
    // first error is pending; duplicate error is suppressed immediately
    expect(summaryCalls()).toHaveLength(0);

    flushEventDropSummary();
    expect(summaryCalls()[0][1]).toMatchObject({
      notAttachedError: 1,
      notAttachedSnapshot: 1,
      notAttachedStatus: 1,
      suppressedCount: 3,
    });
  });

  it('emits stale_revision once per operation type then suppresses', async () => {
    noteConversationGenerationAttached('cgo_one');
    logEventDropped('cgo_one', 'stale_revision', 'snapshot', 3);
    logEventDropped('cgo_one', 'stale_revision', 'snapshot', 3);

    await vi.waitFor(() => {
      expect(droppedCalls()).toHaveLength(1);
    });
    expect(droppedCalls()[0][1]).toMatchObject({
      hadAttached: true,
      reason: 'stale_revision',
      revision: 3,
      type: 'snapshot',
    });

    flushEventDropSummary();
    expect(summaryCalls()[0][1]).toMatchObject({
      emittedCount: 1,
      staleRevisionCount: 2,
      suppressedCount: 1,
    });
  });
});
