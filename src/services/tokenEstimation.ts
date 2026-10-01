import { lambdaClient } from '@/libs/trpc/client';

const CACHE_TTL_MS = 30_000;

let cached:
  | {
      at: number;
      key: string;
      multiplier: number;
    }
  | undefined;

const cacheKey = (provider: string, model: string) => `${provider}\0${model}`;

export const getTokenEstimateMultiplier = async (
  provider?: string,
  model?: string,
): Promise<number> => {
  if (!provider || !model) return 1;
  const key = cacheKey(provider, model);
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.multiplier;
  }

  try {
    const { multiplier } = await lambdaClient.tokenEstimation.getMultiplier.query({
      model,
      provider,
    });
    const next = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    cached = { at: Date.now(), key, multiplier: next };
    return next;
  } catch {
    return cached?.key === key ? cached.multiplier : 1;
  }
};

export const invalidateTokenEstimateMultiplier = () => {
  cached = undefined;
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
