import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logCompactionDebugSafe } = vi.hoisted(() => ({
  logCompactionDebugSafe: vi.fn(),
}));

vi.mock('@/libs/logger/compactionDebug', () => ({
  hashCompactionDebugValue: () => 'hashed-marker-key',
  logCompactionDebugSafe,
}));

import { dispatchDueAssistantMemoryDreams } from './dispatcher';

describe('dispatchDueAssistantMemoryDreams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a safe enqueue failure without raw agent ids or error text', async () => {
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

    const settled = logCompactionDebugSafe.mock.calls.find(
      ([event]) => event === 'dream_scheduler_settled',
    );
    expect(settled).toBeDefined();
    expect(settled?.[1]).toMatchObject({
      path: 'assistant_memory_rollup',
      reason: 'enqueue_failed',
      status: 'failed',
      trigger: 'scheduled',
    });
    expect(JSON.stringify(logCompactionDebugSafe.mock.calls)).not.toContain('agent-secret-id');
    expect(JSON.stringify(logCompactionDebugSafe.mock.calls)).not.toContain('raw-database-secret');
  });
});
