import type { ModelTokensUsage, UIChatMessage } from '@lobechat/types';

export type PromptCacheHitStatus = 'hit' | 'miss' | 'reported';

export interface PromptCacheHitRate {
  cacheEligibleTokens?: number;
  cacheHitRate?: number;
  cacheHitTokens?: number;
  status: PromptCacheHitStatus;
}

type PromptCacheMessage = Pick<UIChatMessage, 'metadata' | 'role'>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const hasPromptCacheTelemetry = (
  usage?: ModelTokensUsage | null,
): usage is ModelTokensUsage =>
  !!usage &&
  (isFiniteNumber(usage.inputCachedTokens) ||
    isFiniteNumber(usage.inputCacheMissTokens) ||
    isFiniteNumber(usage.inputWriteCacheTokens));

export const getPromptCacheHitRate = (
  usage?: ModelTokensUsage | null,
): PromptCacheHitRate | undefined => {
  if (!hasPromptCacheTelemetry(usage)) return undefined;

  const hasWrite = isFiniteNumber(usage.inputWriteCacheTokens);
  const hasMiss = isFiniteNumber(usage.inputCacheMissTokens);
  const hasHit = isFiniteNumber(usage.inputCachedTokens);

  let cacheHitTokens: number | undefined;
  if (hasHit) {
    cacheHitTokens = usage.inputCachedTokens;
  } else if (hasWrite || hasMiss) {
    cacheHitTokens = 0;
  }

  let cacheEligibleTokens: number | undefined;
  if (hasWrite) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputWriteCacheTokens;
  } else if (hasMiss) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputCacheMissTokens;
  } else if (hasHit && isFiniteNumber(usage.totalInputTokens)) {
    cacheEligibleTokens = usage.totalInputTokens;
  }

  const cacheHitRate =
    cacheHitTokens !== undefined &&
    cacheEligibleTokens !== undefined &&
    cacheEligibleTokens > 0
      ? cacheHitTokens / cacheEligibleTokens
      : undefined;

  let status: PromptCacheHitStatus = 'reported';
  if (cacheHitTokens !== undefined) {
    status = cacheHitTokens > 0 ? 'hit' : 'miss';
  }

  return {
    cacheEligibleTokens,
    cacheHitRate,
    cacheHitTokens,
    status,
  };
};

export const findLatestPromptCacheUsage = (
  messages: PromptCacheMessage[],
): ModelTokensUsage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (hasPromptCacheTelemetry(message.metadata)) return message.metadata;
  }

  return undefined;
};
