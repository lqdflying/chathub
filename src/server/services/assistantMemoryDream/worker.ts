import { type Task } from 'graphile-worker';

import { getServerDB } from '@/database/core/db-adaptor';
import { logCompactionDebugSafe } from '@/libs/logger/compactionDebug';

import { ASSISTANT_MEMORY_DREAM_SWEEP_INTERVAL_MS, shouldStartAssistantMemoryDreamScheduler } from './constants';
import { dispatchDueAssistantMemoryDreams } from './dispatcher';
import { executeAssistantMemoryDream } from './execute';

type GlobalWithDreamScheduler = typeof globalThis & {
  __chathubAssistantMemoryDreamSignalsRegistered?: boolean;
  __chathubAssistantMemoryDreamSweepInFlight?: Promise<void>;
  __chathubAssistantMemoryDreamSweeper?: ReturnType<typeof setInterval>;
};

export const handleAssistantMemoryDreamJob: Task = async (payload) => {
  const { agentId, periodStamp, userId } = (payload || {}) as {
    agentId?: string;
    periodStamp?: string;
    userId?: string;
  };
  if (!agentId || !periodStamp || !userId) {
    logCompactionDebugSafe('dream_scheduler_settled', {
      path: 'assistant_memory_rollup',
      reason: 'malformed_job',
      status: 'failed',
      trigger: 'scheduled',
    });
    return;
  }

  const db = await getServerDB();
  await executeAssistantMemoryDream({ agentId, db, periodStamp, userId });
};

const runDreamDispatch = async () => {
  const globalState = globalThis as GlobalWithDreamScheduler;
  if (globalState.__chathubAssistantMemoryDreamSweepInFlight) {
    return globalState.__chathubAssistantMemoryDreamSweepInFlight;
  }

  const run = (async () => {
    const db = await getServerDB();
    await dispatchDueAssistantMemoryDreams(db);
  })();

  globalState.__chathubAssistantMemoryDreamSweepInFlight = run;
  try {
    await run;
  } finally {
    if (globalState.__chathubAssistantMemoryDreamSweepInFlight === run) {
      globalState.__chathubAssistantMemoryDreamSweepInFlight = undefined;
    }
  }
};

export const stopAssistantMemoryDreamScheduler = () => {
  const globalState = globalThis as GlobalWithDreamScheduler;
  if (globalState.__chathubAssistantMemoryDreamSweeper) {
    clearInterval(globalState.__chathubAssistantMemoryDreamSweeper);
    globalState.__chathubAssistantMemoryDreamSweeper = undefined;
  }
};

const handleDreamSignal = (signal: 'SIGINT' | 'SIGTERM') => {
  stopAssistantMemoryDreamScheduler();
  void signal;
};

export const registerAssistantMemoryDreamShutdown = () => {
  const globalState = globalThis as GlobalWithDreamScheduler;
  if (globalState.__chathubAssistantMemoryDreamSignalsRegistered) return;
  globalState.__chathubAssistantMemoryDreamSignalsRegistered = true;

  process.once('SIGINT', () => handleDreamSignal('SIGINT'));
  process.once('SIGTERM', () => handleDreamSignal('SIGTERM'));
};

export const startAssistantMemoryDreamScheduler = () => {
  if (!shouldStartAssistantMemoryDreamScheduler()) return;

  registerAssistantMemoryDreamShutdown();
  const globalState = globalThis as GlobalWithDreamScheduler;
  if (globalState.__chathubAssistantMemoryDreamSweeper) return;

  const sweepTimer = setInterval(() => {
    void runDreamDispatch().catch((error) => {
      console.error('[assistant-memory-dream] periodic dispatch failed', error);
    });
  }, ASSISTANT_MEMORY_DREAM_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  globalState.__chathubAssistantMemoryDreamSweeper = sweepTimer;

  void runDreamDispatch().catch((error) => {
    console.error('[assistant-memory-dream] initial dispatch failed', error);
  });
};
