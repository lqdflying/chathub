export const ASSISTANT_MEMORY_DREAM_TASK = 'assistant_memory_dream';

export const ASSISTANT_MEMORY_DREAM_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export const ASSISTANT_MEMORY_DREAM_MAX_ATTEMPTS = 8;

export const shouldStartAssistantMemoryDreamScheduler = () => {
  if (!process.env.DATABASE_URL) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.DISABLE_CONVERSATION_WORKER === '1') return false;
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  return true;
};
