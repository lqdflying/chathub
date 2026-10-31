import { describe, expect, it, vi } from 'vitest';

import { deepseekUsageAdapter, parseDeepSeekBalance, resolveDeepSeekBalanceUrl } from './deepseek';

const context = (fetchFn: typeof fetch, baseURL?: string) => ({
  credential: { apiKey: 'sk-test-deepseek-key', baseURL },
  fetchFn,
  now: new Date('2026-10-31T00:00:00Z'),
  timeoutMs: 1000,
});

describe('resolveDeepSeekBalanceUrl', () => {
  it('drops a trailing /v1 so the balance path sits at the API root', () => {
    expect(resolveDeepSeekBalanceUrl()).toBe('https://api.deepseek.com/user/balance');
    expect(resolveDeepSeekBalanceUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/user/balance',
    );
    expect(resolveDeepSeekBalanceUrl('https://proxy.example.com/deepseek')).toBe(
      'https://proxy.example.com/deepseek/user/balance',
    );
  });
});

describe('parseDeepSeekBalance', () => {
  it('reads the documented balance_infos shape with string amounts', () => {
    expect(
      parseDeepSeekBalance({
        balance_infos: [
          {
            currency: 'CNY',
            granted_balance: '10.00',
            topped_up_balance: '100.00',
            total_balance: '110.00',
          },
        ],
        is_available: true,
      }),
    ).toEqual({
      balances: [{ currency: 'CNY', granted: 10, paid: 100, total: 110 }],
      isAvailable: true,
      status: 'ok',
    });
  });

  it('keeps is_available false so the UI can warn', () => {
    expect(parseDeepSeekBalance({ balance_infos: [], is_available: false })).toEqual({
      balances: [],
      isAvailable: false,
      status: 'ok',
    });
  });

  it('treats an unrecognized body as an error, not a zero balance', () => {
    expect(parseDeepSeekBalance({ error: { message: 'nope' } })).toEqual({ status: 'error' });
  });
});

describe('deepseekUsageAdapter', () => {
  it('sends the key as a bearer token and maps 401 to authError', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(deepseekUsageAdapter.fetchUsage(context(fetchFn as never))).resolves.toEqual({
      status: 'authError',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.deepseek.com/user/balance',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-deepseek-key' }),
        method: 'GET',
      }),
    );
  });
});
