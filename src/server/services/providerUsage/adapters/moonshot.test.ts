import { describe, expect, it, vi } from 'vitest';

import {
  moonshotUsageAdapter,
  parseKimiCodeUsages,
  parseMoonshotBalance,
  resolveKimiCodeUsagesUrl,
  resolveMoonshotBalanceUrl,
  resolveMoonshotCurrency,
} from './moonshot';

const context = (fetchFn: typeof fetch, baseURL?: string) => ({
  credential: { apiKey: 'sk-test-moonshot-key', baseURL },
  fetchFn,
  now: new Date('2026-10-31T00:00:00Z'),
  timeoutMs: 1000,
});

describe('moonshot URL and currency resolution', () => {
  it('builds the balance path under /v1 for both platforms', () => {
    expect(resolveMoonshotBalanceUrl()).toBe('https://api.moonshot.cn/v1/users/me/balance');
    expect(resolveMoonshotBalanceUrl('https://api.moonshot.ai')).toBe(
      'https://api.moonshot.ai/v1/users/me/balance',
    );
  });

  it('uses CNY for the China platform and USD otherwise', () => {
    expect(resolveMoonshotCurrency()).toBe('CNY');
    expect(resolveMoonshotCurrency('https://api.moonshot.cn/v1')).toBe('CNY');
    expect(resolveMoonshotCurrency('https://api.moonshot.ai/v1')).toBe('USD');
  });

  it('builds the Kimi Code usages path with or without /v1', () => {
    expect(resolveKimiCodeUsagesUrl('https://api.kimi.com/coding/v1')).toBe(
      'https://api.kimi.com/coding/v1/usages',
    );
    expect(resolveKimiCodeUsagesUrl('https://api.kimi.com/coding/')).toBe(
      'https://api.kimi.com/coding/v1/usages',
    );
  });
});

describe('parseMoonshotBalance', () => {
  it('maps available / voucher / cash from the documented example', () => {
    expect(
      parseMoonshotBalance(
        {
          code: 0,
          data: { available_balance: 49.58894, cash_balance: 3.00001, voucher_balance: 46.58893 },
          scode: '0x0',
          status: true,
        },
        'USD',
      ),
    ).toEqual({
      balances: [{ currency: 'USD', granted: 46.58893, paid: 3.00001, total: 49.58894 }],
      isAvailable: true,
      status: 'ok',
    });
  });

  it('flags a zero or negative available balance as unavailable for calls', () => {
    const result = parseMoonshotBalance(
      { data: { available_balance: 0, cash_balance: -1, voucher_balance: 0 }, status: true },
      'CNY',
    );
    expect(result.isAvailable).toBe(false);
  });

  it('treats status:false as an error', () => {
    expect(parseMoonshotBalance({ status: false }, 'CNY')).toEqual({ status: 'error' });
  });
});

describe('parseKimiCodeUsages', () => {
  it('reads string numbers, derives used from remaining, and classifies the 5-hour window', () => {
    const result = parseKimiCodeUsages({
      limits: [
        {
          detail: { limit: '100', remaining: '80', resetTime: '2026-07-11T13:59:07.479363Z' },
          window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        },
      ],
      usage: { limit: '100', remaining: '40', resetTime: '2026-07-13T09:59:07.479363Z' },
    });

    expect(result.status).toBe('ok');
    expect(result.unofficial).toBe(true);
    expect(result.windows).toEqual([
      {
        kind: 'fiveHour',
        limit: 100,
        remaining: 80,
        remainingPercent: 80,
        resetsAt: '2026-07-11T13:59:07.479Z',
        used: 20,
        usedPercent: 20,
        windowMinutes: 300,
      },
      {
        kind: 'weekly',
        limit: 100,
        remaining: 40,
        remainingPercent: 40,
        resetsAt: '2026-07-13T09:59:07.479Z',
        used: 60,
        usedPercent: 60,
      },
    ]);
  });

  it('returns an error when no window can be read', () => {
    expect(parseKimiCodeUsages({})).toEqual({ status: 'error', unofficial: true });
  });
});

describe('moonshotUsageAdapter', () => {
  it('routes a Kimi Code base URL to the usages endpoint', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ usage: { limit: 10, remaining: 5 } }), { status: 200 }),
    );
    const result = await moonshotUsageAdapter.fetchUsage(
      context(fetchFn as never, 'https://api.kimi.com/coding/v1'),
    );
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.kimi.com/coding/v1/usages');
    expect(result.status).toBe('ok');
  });

  it('routes the default base URL to the balance endpoint', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { available_balance: 5 }, status: true }), {
          status: 200,
        }),
    );
    const result = await moonshotUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.moonshot.cn/v1/users/me/balance');
    expect(result.balances?.[0]).toMatchObject({ currency: 'CNY', total: 5 });
  });
});
