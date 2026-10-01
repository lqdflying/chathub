import { lambdaClient } from '@/libs/trpc/client';

const CACHE_TTL_MS = 30_000;

let cached:
  | {
      at: number;
      key: string;
      multiplier: number;
    }
  | undefined;
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<number>>();
/** Bumped when a newer read or an invalidation retires older responses. */
let cacheEpoch = 0;

const cacheKey = (provider: string, model: string) => `${provider}\0${model}`;

export const subscribeTokenEstimateMultiplier = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getTokenEstimateMultiplier = async (
  provider?: string,
  model?: string,
  options?: { fresh?: boolean },
): Promise<number> => {
  if (!provider || !model) return 1;
  const key = cacheKey(provider, model);
  if (
    !options?.fresh &&
    cached &&
    cached.key === key &&
    Date.now() - cached.at < CACHE_TTL_MS
  ) {
    return cached.multiplier;
  }

  if (options?.fresh) {
    cacheEpoch += 1;
    inflight.delete(key);
  } else {
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const startedEpoch = cacheEpoch;
  const holder: { current?: Promise<number> } = {};
  const request = (async () => {
    try {
      const { multiplier } = await lambdaClient.tokenEstimation.getMultiplier.query({
        model,
        provider,
      });
      const next = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
      if (startedEpoch === cacheEpoch) {
        cached = { at: Date.now(), key, multiplier: next };
      }
      return next;
    } catch {
      return cached?.key === key ? cached.multiplier : 1;
    } finally {
      if (inflight.get(key) === holder.current) inflight.delete(key);
    }
  })();
  holder.current = request;
  if (!options?.fresh) inflight.set(key, request);
  return request;
};

export const invalidateTokenEstimateMultiplier = () => {
  cacheEpoch += 1;
  cached = undefined;
  inflight.clear();
  for (const listener of listeners) listener();
};

export const reportTokenCalibration = async (input: {
  actualInputTokens?: number;
  eligible: boolean;
  model?: string;
  provider?: string;
  uncalibratedInputTokens?: number;
}): Promise<void> => {
  if (
    !input.eligible ||
    !input.provider ||
    !input.model ||
    !input.actualInputTokens ||
    !input.uncalibratedInputTokens
  ) {
    return;
  }

  try {
    await lambdaClient.tokenEstimation.observe.mutate({
      actualInputTokens: input.actualInputTokens,
      eligible: true,
      model: input.model,
      provider: input.provider,
      uncalibratedInputTokens: input.uncalibratedInputTokens,
    });
    invalidateTokenEstimateMultiplier();
  } catch {
    // Calibration must not affect the chat that produced the usage.
  }
};
