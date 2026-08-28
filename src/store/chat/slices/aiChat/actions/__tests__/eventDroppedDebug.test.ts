/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as generationDebugClient from '@/libs/logger/generationDebugClient';
import { lambdaClient } from '@/libs/trpc/client';

import {
  EVENT_DROP_ATTACH_RACE_MS,
  EVENT_DROP_SUMMARY_FLUSH_AT,
  flushEventDropSummary,
  logEventDropped,
  noteConversationGenerationAttached,
  resetEventDroppedDebugState,
} from '../eventDroppedDebug';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    conversationGeneration: {
      reportClientDebug: { mutate: vi.fn().mockResolvedValue({ accepted: 1 }) },
    },
  },
}));

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

  it('settles a pending attach-race terminal into the hide summary', () => {
    logEventDropped('cgo_pending', 'not_attached', 'done');
    expect(summaryCalls()).toHaveLength(0);

    window.dispatchEvent(new Event('pagehide'));

    expect(droppedCalls()).toHaveLength(0);
    expect(summaryCalls()).toEqual([
      [
        'event_drop_summary',
        expect.objectContaining({
          notAttachedDone: 1,
          suppressedCount: 1,
        }),
      ],
    ]);
  });
});

describe('eventDroppedDebug pagehide queue', () => {
  const reportedDebugEvents = () =>
    vi
      .mocked(lambdaClient.conversationGeneration.reportClientDebug.mutate)
      .mock.calls.flatMap(
        (call) =>
          (call[0] as { events: Array<{ event: string; fields?: Record<string, unknown> }> })
            .events,
      );

  beforeEach(() => {
    resetEventDroppedDebugState();
    localStorage.setItem('chathub.generationDebug', '1');
    vi.mocked(lambdaClient.conversationGeneration.reportClientDebug.mutate).mockClear();
  });

  afterEach(() => {
    localStorage.removeItem('chathub.generationDebug');
    resetEventDroppedDebugState();
  });

  it('delivers event_drop_summary on pagehide after the logger hide listener already registered', async () => {
    generationDebugClient.logGenerationDebugClientSafe('send_started', { spanId: 'gd_hide' });
    logEventDropped('cgo_replay_a', 'not_attached', 'status');
    logEventDropped('cgo_replay_b', 'not_attached', 'status');

    window.dispatchEvent(new Event('pagehide'));

    // Logger hide flush uses a dynamic import; wait for the later summary
    // mutate, not merely the first send_started flush.
    await vi.waitFor(() => {
      expect(reportedDebugEvents().some((item) => item.event === 'event_drop_summary')).toBe(true);
    });

    const events = reportedDebugEvents();
    expect(events.some((item) => item.event === 'send_started')).toBe(true);
    const summary = events.find((item) => item.event === 'event_drop_summary');
    expect(summary?.fields).toMatchObject({
      notAttachedStatus: 2,
      suppressedCount: 2,
    });
  });
});
