import { LOADING_FLAT } from '@/const/message';
import { describe, expect, it } from 'vitest';

import {
  findLatestPromptCacheUsage,
  getPromptCacheHitRate,
  hasPromptCacheTelemetry,
  resolveStoredMessageUsage,
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
  it('returns undefined when there is no usage', () => {
    expect(getPromptCacheHitRate(undefined)).toBeUndefined();
    expect(getPromptCacheHitRate({})).toBeUndefined();
  });

  it('treats totals-only usage as a reported zero hit against total input', () => {
    expect(
      getPromptCacheHitRate({ totalInputTokens: 2000, totalTokens: 2100 }),
    ).toEqual({
      cacheEligibleTokens: 2000,
      cacheHitRate: 0,
      cacheHitTokens: 0,
      status: 'reported',
    });
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

  it('uses DeepSeek hit plus miss as eligible when total input is absent', () => {
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

  it('uses total input for Anthropic write-only and later hit-only turns', () => {
    const writeOnly = getPromptCacheHitRate({
      inputCacheMissTokens: 6,
      inputWriteCacheTokens: 400,
      totalInputTokens: 406,
    });
    const readAndWrite = getPromptCacheHitRate({
      inputCacheMissTokens: 900,
      inputCachedTokens: 100,
      inputWriteCacheTokens: 100,
      totalInputTokens: 1100,
    });
    const readOnlyAfterZeroWriteStripped = getPromptCacheHitRate({
      inputCacheMissTokens: 900,
      inputCachedTokens: 100,
      totalInputTokens: 1000,
    });

    expect(writeOnly).toEqual({
      cacheEligibleTokens: 406,
      cacheHitRate: 0,
      cacheHitTokens: 0,
      status: 'miss',
    });
    expect(readAndWrite?.cacheEligibleTokens).toBe(1100);
    expect(readAndWrite?.cacheHitRate).toBeCloseTo(100 / 1100);
    expect(readOnlyAfterZeroWriteStripped?.cacheEligibleTokens).toBe(1000);
    expect(readOnlyAfterZeroWriteStripped?.cacheHitRate).toBeCloseTo(100 / 1000);
  });

  it('keeps the same all-input denominator after Anthropic strips a zero write counter', () => {
    const withWrite = getPromptCacheHitRate({
      inputCacheMissTokens: 900,
      inputCachedTokens: 100,
      inputWriteCacheTokens: 100,
      totalInputTokens: 1100,
    });
    const writeStripped = getPromptCacheHitRate({
      inputCacheMissTokens: 900,
      inputCachedTokens: 100,
      totalInputTokens: 1000,
    });

    expect(withWrite?.cacheEligibleTokens).toBe(1100);
    expect(writeStripped?.cacheEligibleTokens).toBe(1000);
    expect(withWrite?.cacheEligibleTokens).not.toBe(200);
    expect(writeStripped?.cacheEligibleTokens).not.toBe(100);
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
  it('returns undefined when no assistant reported usage', () => {
    expect(findLatestPromptCacheUsage([])).toBeUndefined();
    expect(
      findLatestPromptCacheUsage([
        { content: 'hi', metadata: { totalInputTokens: 10 }, role: 'user' },
      ]),
    ).toBeUndefined();
  });

  it('falls back to totals-only usage when no cache counters exist', () => {
    const totals = { totalInputTokens: 20, totalTokens: 30 };
    expect(
      findLatestPromptCacheUsage([
        { content: 'hi', metadata: { totalInputTokens: 10 }, role: 'user' },
        { content: 'done', extra: { fromModel: 'gpt-test' }, metadata: totals, role: 'assistant' },
      ]),
    ).toEqual({
      fromModel: 'gpt-test',
      usage: totals,
    });
  });

  it('keeps older reported cache while an in-flight assistant has no metadata', () => {
    const olderCache = { inputCachedTokens: 80, totalInputTokens: 100 };
    const source = findLatestPromptCacheUsage([
      {
        content: 'cached',
        extra: { fromModel: 'gpt-test' },
        metadata: olderCache,
        role: 'assistant',
      },
      { content: 'hi', metadata: undefined, role: 'user' },
      { content: LOADING_FLAT, metadata: undefined, role: 'assistant' },
    ]);

    expect(source?.usage).toBe(olderCache);
    expect(source?.fromModel).toBe('gpt-test');
  });

  it('keeps older reported cache after a completed totals-only assistant', () => {
    const olderCache = { inputCachedTokens: 80, totalInputTokens: 100 };
    const source = findLatestPromptCacheUsage([
      { content: 'cached', metadata: olderCache, role: 'assistant' },
      { content: 'hi', metadata: undefined, role: 'user' },
      {
        content: 'no cache fields',
        metadata: { totalInputTokens: 200, totalTokens: 250 },
        role: 'assistant',
      },
    ]);

    expect(source?.usage).toBe(olderCache);
  });

  it('uses the newest assistant that reported cache telemetry', () => {
    const latestCache = { inputCacheMissTokens: 30, inputCachedTokens: 120 };

    expect(
      findLatestPromptCacheUsage([
        {
          content: 'older',
          metadata: { inputCachedTokens: 10, totalInputTokens: 40 },
          role: 'assistant',
        },
        { content: 'hi', metadata: undefined, role: 'user' },
        { content: 'latest', extra: { fromModel: 'kimi' }, metadata: latestCache, role: 'assistant' },
      ]),
    ).toEqual({
      fromModel: 'kimi',
      usage: latestCache,
    });
  });

  it('reads grouped tool-turn usage after metadata is split onto usage/children', () => {
    const childUsage = { inputCachedTokens: 80, totalInputTokens: 100 };
    const source = findLatestPromptCacheUsage([
      {
        children: [{ content: 'tool call', id: 'child-1', usage: childUsage }],
        content: '',
        extra: { fromModel: 'gpt-test' },
        metadata: undefined,
        role: 'group',
        usage: { inputCachedTokens: 80, totalInputTokens: 100 },
      },
    ]);

    expect(source).toEqual({
      fromModel: 'gpt-test',
      usage: childUsage,
    });
  });

  it('reads assistant usage when metadata was not copied into the store message', () => {
    const usage = { inputCachedTokens: 40, totalInputTokens: 80 };
    expect(
      findLatestPromptCacheUsage([
        { content: 'reply', extra: { fromModel: 'kimi' }, role: 'assistant', usage },
      ]),
    ).toEqual({
      fromModel: 'kimi',
      usage,
    });
  });

  it('unwraps nested durable metadata.usage for cache telemetry', () => {
    const nested = { inputCachedTokens: 18_688, totalInputTokens: 18_788, totalTokens: 18_869 };
    const source = findLatestPromptCacheUsage([
      {
        content: 'cached',
        extra: { fromModel: 'deepseek-v4-flash' },
        metadata: {
          conversationGenerationTurnComplete: true,
          usage: nested,
        } as any,
        role: 'assistant',
      },
    ]);

    expect(source?.fromModel).toBe('deepseek-v4-flash');
    expect(source?.usage).toMatchObject(nested);
    expect(getPromptCacheHitRate(source?.usage)?.cacheHitRate).toBeCloseTo(18_688 / 18_788);
  });
});

describe('resolveStoredMessageUsage', () => {
  it('returns flat metadata unchanged', () => {
    const flat = { inputCachedTokens: 10, totalInputTokens: 20, totalTokens: 25 };
    expect(resolveStoredMessageUsage(flat)).toEqual(flat);
  });

  it('merges nested usage onto sibling metadata flags', () => {
    const nested = { inputCachedTokens: 8, totalInputTokens: 10, totalTokens: 12 };
    expect(
      resolveStoredMessageUsage({
        conversationGenerationTurnComplete: true,
        usage: nested,
      } as any),
    ).toMatchObject({
      conversationGenerationTurnComplete: true,
      ...nested,
    });
  });
});
