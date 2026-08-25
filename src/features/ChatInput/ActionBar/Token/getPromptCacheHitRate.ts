import type { ModelTokensUsage, UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';

export type PromptCacheHitStatus = 'hit' | 'miss' | 'reported';

export interface PromptCacheHitRate {
  cacheEligibleTokens?: number;
  cacheHitRate?: number;
  cacheHitTokens?: number;
  status: PromptCacheHitStatus;
}

export interface PromptCacheUsageSource {
  fromModel?: string;
  usage: ModelTokensUsage;
}

type PromptCacheMessage = Pick<UIChatMessage, 'content' | 'extra' | 'metadata' | 'role'>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const hasPromptCacheTelemetry = (
  usage?: ModelTokensUsage | null,
): usage is ModelTokensUsage =>
  !!usage &&
  (isFiniteNumber(usage.inputCachedTokens) ||
    isFiniteNumber(usage.inputCacheMissTokens) ||
    isFiniteNumber(usage.inputWriteCacheTokens));

/**
 * Hit rate is cached tokens divided by all provider-reported input.
 * Do not switch the denominator when a zero Anthropic write counter was stripped.
 */
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
  if (isFiniteNumber(usage.totalInputTokens) && usage.totalInputTokens > 0) {
    cacheEligibleTokens = usage.totalInputTokens;
  } else if (hasMiss) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputCacheMissTokens;
  } else if (hasWrite) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputWriteCacheTokens;
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
): PromptCacheUsageSource | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    // Skip in-flight placeholders; a completed totals-only reply is still skipped
    // so the most recent *reported* cache remains visible.
    if (message.content === LOADING_FLAT) continue;
    if (hasPromptCacheTelemetry(message.metadata)) {
      return {
        fromModel: message.extra?.fromModel,
        usage: message.metadata,
      };
    }
  }

  return undefined;
};
