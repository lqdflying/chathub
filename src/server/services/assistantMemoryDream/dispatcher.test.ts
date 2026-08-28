import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPACTION_DEBUG_NAMESPACE } from '@/libs/logger/compactionDebug';

import { dispatchDueAssistantMemoryDreams } from './dispatcher';

describe('dispatchDueAssistantMemoryDreams', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logs enqueue failure with hashed marker and without raw ids or error text', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('raw-database-secret'));
    const db = {
      execute,
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              assistantMemoryMeta: {},
              chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
              id: 'agent-secret-id',
              userId: 'user-secret-id',
            },
          ]),
        })),
      })),
    } as any;

    await dispatchDueAssistantMemoryDreams(db, new Date('2026-08-28T03:00:00.000Z'));

    const settledCall = consoleLogSpy.mock.calls.find((call) =>
      String(call[0]).includes(`${COMPACTION_DEBUG_NAMESPACE}:dream_scheduler_settled`),
    );
    expect(settledCall).toBeDefined();

    const record = JSON.parse(settledCall![1] as string);
    expect(record).toMatchObject({
      path: 'assistant_memory_rollup',
      reason: 'enqueue_failed',
      status: 'failed',
      trigger: 'scheduled',
    });
    expect(record.markerKeyHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(record)).not.toContain('agent-secret-id');
    expect(JSON.stringify(record)).not.toContain('raw-database-secret');
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('agent-secret-id');
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('raw-database-secret');
  });
});
