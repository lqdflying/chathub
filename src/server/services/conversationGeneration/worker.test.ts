/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getServerDB: vi.fn(),
  run: vi.fn(),
  sweepPending: vi.fn(),
  sweepStale: vi.fn(),
}));

vi.mock('graphile-worker', () => ({
  run: mocks.run,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('./execute', () => ({
  executeConversationGeneration: mocks.execute,
}));

vi.mock('./service', () => ({
  sweepPendingConversationGenerationJobs: mocks.sweepPending,
  sweepStaleConversationGenerationOperations: mocks.sweepStale,
}));

import {
  CONVERSATION_GENERATION_SWEEP_INTERVAL_MS,
} from './constants';
import {
  registerConversationGenerationShutdown,
  startConversationGenerationSweeper,
  startConversationGenerationWorker,
  stopConversationGenerationWorker,
} from './worker';

const GLOBAL_KEYS = [
  '__chathubConversationGenerationShutdown',
  '__chathubConversationGenerationSignalsRegistered',
  '__chathubConversationGenerationSweepInFlight',
  '__chathubConversationGenerationSweeper',
  '__chathubConversationGenerationWorker',
] as const;

describe('conversation generation worker lifecycle', () => {
  let originalIntListeners: ReturnType<typeof process.listeners>;
  let originalTermListeners: ReturnType<typeof process.listeners>;
  let originalDatabaseUrl: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgres://test';
    process.env.NODE_ENV = 'development';
    originalIntListeners = process.listeners('SIGINT');
    originalTermListeners = process.listeners('SIGTERM');
    for (const key of GLOBAL_KEYS) delete (globalThis as Record<string, unknown>)[key];
  });

  afterEach(async () => {
    await stopConversationGenerationWorker();
    for (const listener of process.listeners('SIGINT')) {
      if (!originalIntListeners.includes(listener)) process.removeListener('SIGINT', listener);
    }
    for (const listener of process.listeners('SIGTERM')) {
      if (!originalTermListeners.includes(listener)) process.removeListener('SIGTERM', listener);
    }
    for (const key of GLOBAL_KEYS) delete (globalThis as Record<string, unknown>)[key];
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnv;
    vi.useRealTimers();
  });

  it('registers each process signal handler only once', () => {
    registerConversationGenerationShutdown();
    registerConversationGenerationShutdown();

    expect(process.listenerCount('SIGINT')).toBe(originalIntListeners.length + 1);
    expect(process.listenerCount('SIGTERM')).toBe(originalTermListeners.length + 1);
  });

  it('deduplicates startup and awaits Runner.stop during shutdown', async () => {
    const runner = { stop: vi.fn().mockResolvedValue(undefined) };
    mocks.run.mockResolvedValue(runner);

    const [first, second] = await Promise.all([
      startConversationGenerationWorker(),
      startConversationGenerationWorker(),
    ]);

    expect(first).toBe(runner);
    expect(second).toBe(runner);
    expect(mocks.run).toHaveBeenCalledTimes(1);

    await Promise.all([
      stopConversationGenerationWorker(),
      stopConversationGenerationWorker(),
    ]);
    expect(runner.stop).toHaveBeenCalledTimes(1);
  });

  it('clears the periodic sweeper during shutdown', async () => {
    vi.useFakeTimers();
    mocks.getServerDB.mockResolvedValue({});
    mocks.sweepPending.mockResolvedValue(undefined);
    mocks.sweepStale.mockResolvedValue(undefined);

    startConversationGenerationSweeper();
    await vi.runOnlyPendingTimersAsync();
    const callsBeforeShutdown = mocks.getServerDB.mock.calls.length;

    await stopConversationGenerationWorker();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getServerDB).toHaveBeenCalledTimes(callsBeforeShutdown);
  });

  it('does not start a second sweep while one is already in flight', async () => {
    vi.useFakeTimers();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.getServerDB.mockResolvedValue({});
    mocks.sweepPending.mockResolvedValue(undefined);
    mocks.sweepStale.mockImplementation(() => held);

    startConversationGenerationSweeper();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.sweepStale).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CONVERSATION_GENERATION_SWEEP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(CONVERSATION_GENERATION_SWEEP_INTERVAL_MS);

    expect(mocks.sweepStale).toHaveBeenCalledTimes(1);
    expect(mocks.sweepPending).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
  });
});
