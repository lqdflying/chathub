import { describe, expect, it, vi } from 'vitest';

import {
  classifyZhipuWindow,
  parseZhipuQuota,
  resolveZhipuQuotaUrl,
  zhipuUsageAdapter,
} from './zhipu';

const context = (fetchFn: typeof fetch, baseURL?: string) => ({
  credential: { apiKey: 'zhipu-test-key', baseURL },
  fetchFn,
  now: new Date('2026-10-31T00:00:00Z'),
  timeoutMs: 1000,
});

// Shape from the community quota/limit capture (cc-switch issue #1588 via quotas zai.md).
const QUOTA_FIXTURE = {
  code: 200,
  data: {
    level: 'pro',
    limits: [
      {
        currentValue: 72_000,
        nextResetTime: 1_712_956_800_000,
        number: 5,
        percentage: 7,
        rawType: 'TOKENS_LIMIT',
        remaining: 928_000,
        total: 1_000_000,
        type: '5h Token',
        unit: 3,
        usage: 1_000_000,
      },
      {
        currentValue: 2_650_000,
        nextResetTime: 1_713_388_800_000,
        number: 7,
        percentage: 53,
        rawType: 'TOKENS_LIMIT',
        remaining: 2_350_000,
        type: 'Weekly Token',
        unit: 6,
        usage: 5_000_000,
      },
      {
        currentValue: 42,
        number: 1,
        percentage: 4,
        rawType: 'TIME_LIMIT',
        remaining: 958,
        type: 'MCP usage(1 Month)',
        unit: 5,
        usage: 1000,
      },
    ],
  },
  msg: 'ok',
  success: true,
};

describe('resolveZhipuQuotaUrl', () => {
  it('uses the API origin for both the China and international surfaces', () => {
    expect(resolveZhipuQuotaUrl()).toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit');
    expect(resolveZhipuQuotaUrl('https://api.z.ai/api/coding/paas/v4')).toBe(
      'https://api.z.ai/api/monitor/usage/quota/limit',
    );
  });
});

describe('classifyZhipuWindow', () => {
  it('accepts both weekly encodings and falls back to the type label', () => {
    expect(classifyZhipuWindow(6, 7).kind).toBe('weekly');
    expect(classifyZhipuWindow(6, 1).kind).toBe('weekly');
    expect(classifyZhipuWindow(3, 5).kind).toBe('fiveHour');
    expect(classifyZhipuWindow(99, 1, 'Weekly Token').kind).toBe('weekly');
    expect(classifyZhipuWindow(99, 1, 'something').kind).toBe('custom');
  });
});

describe('parseZhipuQuota', () => {
  it('maps the 5-hour, weekly, and monthly MCP windows', () => {
    const result = parseZhipuQuota(QUOTA_FIXTURE);
    expect(result).toMatchObject({ plan: 'pro', status: 'ok', unofficial: true });
    expect(result.windows).toEqual([
      {
        kind: 'fiveHour',
        limit: 1_000_000,
        remaining: 928_000,
        remainingPercent: 93,
        resetsAt: '2024-04-12T21:20:00.000Z',
        unit: 'tokens',
        used: 72_000,
        usedPercent: 7,
        windowMinutes: 300,
      },
      expect.objectContaining({ kind: 'weekly', remainingPercent: 47, usedPercent: 53 }),
      expect.objectContaining({ kind: 'monthly', label: 'MCP', remaining: 958, usedPercent: 4 }),
    ]);
  });

  it('reports notOnPlan for an unsuccessful or empty body', () => {
    expect(parseZhipuQuota({ code: 500, success: false })).toEqual({
      reason: 'notOnPlan',
      status: 'unavailable',
      unofficial: true,
    });
    expect(parseZhipuQuota({ code: 200, data: { limits: [] }, success: true }).reason).toBe(
      'notOnPlan',
    );
  });
});

describe('zhipuUsageAdapter', () => {
  it('retries once without the Bearer prefix after a 401', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(QUOTA_FIXTURE), { status: 200 }));

    const result = await zhipuUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(result.status).toBe('ok');
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer zhipu-test-key',
    });
    expect(fetchFn.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'zhipu-test-key' });
  });
});
