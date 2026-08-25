import { describe, expect, it } from 'vitest';

import {
  findLatestPromptCacheUsage,
  getPromptCacheHitRate,
  hasPromptCacheTelemetry,
} from './getPromptCacheHitRate';

describe('hasPromptCacheTelemetry', () => {
  it('is false for totals-only usage', () => {
    expect(
      hasPromptCacheTelemetry({
        totalInputTokens: 200,
        totalTokens: 250,
      }),
    ).toBe(false);
  });

  it('is true when any cache field is present', () => {
    expect(hasPromptCacheTelemetry({ inputCachedTokens: 0 })).toBe(true);
    expect(hasPromptCacheTelemetry({ inputCacheMissTokens: 30 })).toBe(true);
    expect(hasPromptCacheTelemetry({ inputWriteCacheTokens: 400 })).toBe(true);
  });
});

describe('getPromptCacheHitRate', () => {
  it('returns undefined when there is no cache telemetry', () => {
    expect(getPromptCacheHitRate(undefined)).toBeUndefined();
    expect(getPromptCacheHitRate({})).toBeUndefined();
    expect(getPromptCacheHitRate({ totalInputTokens: 2000, totalTokens: 2100 })).toBeUndefined();
  });

  it('uses OpenAI prompt tokens as eligible when cached tokens are present', () => {
    const result = getPromptCacheHitRate({
      inputCachedTokens: 1500,
      totalInputTokens: 2000,
    });

    expect(result).toEqual({
      cacheEligibleTokens: 2000,
      cacheHitRate: 0.75,
      cacheHitTokens: 1500,
      status: 'hit',
    });
  });

  it('uses DeepSeek hit plus miss as eligible', () => {
    const result = getPromptCacheHitRate({
      inputCachedTokens: 120,
      inputCacheMissTokens: 30,
    });

    expect(result).toEqual({
      cacheEligibleTokens: 150,
      cacheHitRate: 0.8,
      cacheHitTokens: 120,
      status: 'hit',
    });
  });

  it('treats Anthropic write-only as a miss against creation tokens', () => {
    const withZeroRead = getPromptCacheHitRate({
      inputCachedTokens: 0,
      inputWriteCacheTokens: 400,
    });
    const afterStrippedZeroRead = getPromptCacheHitRate({
      inputCacheMissTokens: 6,
      inputWriteCacheTokens: 400,
    });

    expect(withZeroRead).toEqual({
      cacheEligibleTokens: 400,
      cacheHitRate: 0,
      cacheHitTokens: 0,
      status: 'miss',
    });
    expect(afterStrippedZeroRead).toEqual({
      cacheEligibleTokens: 400,
      cacheHitRate: 0,
      cacheHitTokens: 0,
      status: 'miss',
    });
  });

  it('prefers Anthropic read plus write over miss when write is present', () => {
    const result = getPromptCacheHitRate({
      inputCacheMissTokens: 6,
      inputCachedTokens: 17_918,
      inputWriteCacheTokens: 457,
      totalInputTokens: 18_381,
    });

    expect(result?.cacheHitTokens).toBe(17_918);
    expect(result?.cacheEligibleTokens).toBe(18_375);
    expect(result?.cacheHitRate).toBeCloseTo(17_918 / 18_375);
    expect(result?.status).toBe('hit');
  });

  it('omits the rate when eligible tokens are missing or zero', () => {
    expect(
      getPromptCacheHitRate({
        inputCachedTokens: 100,
      }),
    ).toEqual({
      cacheEligibleTokens: undefined,
      cacheHitRate: undefined,
      cacheHitTokens: 100,
      status: 'hit',
    });

    expect(
      getPromptCacheHitRate({
        inputCachedTokens: 0,
        inputWriteCacheTokens: 0,
      }),
    ).toEqual({
      cacheEligibleTokens: 0,
      cacheHitRate: undefined,
      cacheHitTokens: 0,
      status: 'miss',
    });
  });
});

describe('findLatestPromptCacheUsage', () => {
  it('returns undefined when no assistant reported cache fields', () => {
    expect(findLatestPromptCacheUsage([])).toBeUndefined();
    expect(
      findLatestPromptCacheUsage([
        { metadata: { totalInputTokens: 10 }, role: 'user' },
        { metadata: { totalInputTokens: 20, totalTokens: 30 }, role: 'assistant' },
      ]),
    ).toBeUndefined();
  });

  it('walks newest to oldest and skips totals-only assistant rows', () => {
    const olderCache = { inputCachedTokens: 80, totalInputTokens: 100 };
    const usage = findLatestPromptCacheUsage([
      { metadata: olderCache, role: 'assistant' },
      { metadata: undefined, role: 'user' },
      { metadata: { totalInputTokens: 200, totalTokens: 250 }, role: 'assistant' },
    ]);

    expect(usage).toBe(olderCache);
  });

  it('uses the newest assistant that reported cache telemetry', () => {
    const latestCache = { inputCacheMissTokens: 30, inputCachedTokens: 120 };

    expect(
      findLatestPromptCacheUsage([
        { metadata: { inputCachedTokens: 10, totalInputTokens: 40 }, role: 'assistant' },
        { metadata: undefined, role: 'user' },
        { metadata: latestCache, role: 'assistant' },
      ]),
    ).toBe(latestCache);
  });
});
