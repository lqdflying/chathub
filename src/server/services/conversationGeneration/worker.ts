import { run, type Runner, type Task } from 'graphile-worker';

import { getServerDB } from '@/database/core/db-adaptor';

import {
  CONVERSATION_GENERATION_SWEEP_INTERVAL_MS,
  CONVERSATION_GENERATION_TASK,
} from './constants';
import { executeConversationGeneration } from './execute';
import {
  sweepPendingConversationGenerationJobs,
  sweepStaleConversationGenerationOperations,
} from './service';

type GlobalWithConversationWorker = typeof globalThis & {
  __chathubConversationGenerationShutdown?: Promise<void>;
  __chathubConversationGenerationSignalsRegistered?: boolean;
  __chathubConversationGenerationSweeper?: ReturnType<typeof setInterval>;
  __chathubConversationGenerationWorker?: Promise<Runner | undefined>;
};

const parseConcurrency = () => {
  const value = Number(process.env.CONVERSATION_WORKER_CONCURRENCY || 4);
  return Number.isFinite(value) && value > 0 ? value : 4;
};

export const shouldStartConversationGenerationWorker = () => {
  if (!process.env.DATABASE_URL) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.DISABLE_CONVERSATION_WORKER === '1') return false;
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  return true;
};

const handleConversationGenerationJob: Task = async (payload) => {
  const { operationId, userId } = (payload || {}) as {
    operationId?: string;
    userId?: string;
  };
  if (!operationId || !userId) return;

  const db = await getServerDB();
  await executeConversationGeneration({ db, operationId, userId });
};

const runConversationGenerationSweep = async () => {
  const db = await getServerDB();
  await sweepPendingConversationGenerationJobs(db);
  await sweepStaleConversationGenerationOperations(db);
};

export const stopConversationGenerationWorker = async () => {
  const globalState = globalThis as GlobalWithConversationWorker;
  if (globalState.__chathubConversationGenerationShutdown) {
    return globalState.__chathubConversationGenerationShutdown;
  }

  globalState.__chathubConversationGenerationShutdown = (async () => {
    if (globalState.__chathubConversationGenerationSweeper) {
      clearInterval(globalState.__chathubConversationGenerationSweeper);
      globalState.__chathubConversationGenerationSweeper = undefined;
    }

    const runner = await globalState.__chathubConversationGenerationWorker?.catch(() => undefined);
    if (runner) await runner.stop();
    globalState.__chathubConversationGenerationWorker = undefined;
  })();

  try {
    await globalState.__chathubConversationGenerationShutdown;
  } finally {
    globalState.__chathubConversationGenerationShutdown = undefined;
  }
};

const handleConversationGenerationSignal = (signal: 'SIGINT' | 'SIGTERM') => {
  void stopConversationGenerationWorker().catch((error) => {
    console.error(`[conversation-generation] failed to stop worker after ${signal}`, error);
  });
};

export const registerConversationGenerationShutdown = () => {
  const globalState = globalThis as GlobalWithConversationWorker;
  if (globalState.__chathubConversationGenerationSignalsRegistered) return;
  globalState.__chathubConversationGenerationSignalsRegistered = true;

  process.once('SIGINT', () => handleConversationGenerationSignal('SIGINT'));
  process.once('SIGTERM', () => handleConversationGenerationSignal('SIGTERM'));
};

export const startConversationGenerationSweeper = () => {
  if (!shouldStartConversationGenerationWorker()) return;

  registerConversationGenerationShutdown();
  const globalState = globalThis as GlobalWithConversationWorker;
  if (globalState.__chathubConversationGenerationSweeper) return;

  const sweepTimer = setInterval(() => {
    void runConversationGenerationSweep().catch((error) => {
      console.error('[conversation-generation] periodic sweep failed', error);
    });
  }, CONVERSATION_GENERATION_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  globalState.__chathubConversationGenerationSweeper = sweepTimer;

  void runConversationGenerationSweep().catch((error) => {
    console.error('[conversation-generation] initial sweep failed', error);
  });
};

export const startConversationGenerationWorker = async (): Promise<Runner | undefined> => {
  if (!shouldStartConversationGenerationWorker()) return;

  registerConversationGenerationShutdown();
  const globalState = globalThis as GlobalWithConversationWorker;
  if (globalState.__chathubConversationGenerationWorker) {
    return globalState.__chathubConversationGenerationWorker;
  }

  globalState.__chathubConversationGenerationWorker = (async () => {
    try {
      return await run({
        concurrency: parseConcurrency(),
        connectionString: process.env.DATABASE_URL,
        noHandleSignals: true,
        pollInterval: 1000,
        taskList: {
          [CONVERSATION_GENERATION_TASK]: handleConversationGenerationJob,
        },
      });
    } catch (error) {
      console.error('[conversation-generation] worker failed to start', error);
      globalState.__chathubConversationGenerationWorker = undefined;
      return undefined;
    }
  })();

  return globalState.__chathubConversationGenerationWorker;
};
