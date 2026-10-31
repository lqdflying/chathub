import { describe, expect, it, vi } from 'vitest';

import { minimaxUsageAdapter, parseMinimaxRemains, resolveMinimaxRemainsUrls } from './minimax';

const context = (fetchFn: typeof fetch, baseURL?: string) => ({
  credential: { apiKey: 'minimax-test-key', baseURL },
  fetchFn,
  now: new Date('2026-10-31T00:00:00Z'),
  timeoutMs: 1000,
});

// Real token_plan/remains payload captured by tokmesh-cli (status_code 0 = success).
const REMAINS_FIXTURE = {
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [
    {
      current_interval_remaining_percent: 98,
      current_interval_status: 1,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      current_weekly_remaining_percent: 67,
      current_weekly_status: 1,
      end_time: 1_781_852_400_000,
      model_name: 'general',
      start_time: 1_781_834_400_000,
      weekly_end_time: 1_782_057_600_000,
      weekly_start_time: 1_781_452_800_000,
    },
    {
      current_interval_remaining_percent: 100,
      current_weekly_remaining_percent: 100,
      current_weekly_status: 1,
      end_time: 1_781_884_800_000,
      model_name: 'video',
      start_time: 1_781_798_400_000,
      weekly_end_time: 1_782_057_600_000,
    },
  ],
};

describe('resolveMinimaxRemainsUrls', () => {
  it('picks the China site for minimaxi.com and the global site otherwise', () => {
    expect(resolveMinimaxRemainsUrls('https://api.minimaxi.com/v1')[0]).toBe(
      'https://www.minimaxi.com/v1/token_plan/remains',
    );
    expect(resolveMinimaxRemainsUrls()).toEqual([
      'https://www.minimax.io/v1/token_plan/remains',
      'https://www.minimax.io/v1/api/openplatform/coding_plan/remains',
    ]);
  });
});

describe('parseMinimaxRemains', () => {
  it('reads interval and weekly percentages per model', () => {
    const result = parseMinimaxRemains(REMAINS_FIXTURE);
    expect(result.status).toBe('ok');
    expect(result.windows).toEqual([
      {
        kind: 'fiveHour',
        remainingPercent: 98,
        resetsAt: new Date(1_781_852_400_000).toISOString(),
        usedPercent: 2,
        windowMinutes: 300,
      },
      {
        kind: 'weekly',
        remainingPercent: 67,
        resetsAt: new Date(1_782_057_600_000).toISOString(),
        usedPercent: 33,
      },
      expect.objectContaining({ kind: 'daily', label: 'video', remainingPercent: 100 }),
      expect.objectContaining({ kind: 'weekly', label: 'video', remainingPercent: 100 }),
    ]);
  });

  it('skips an inactive weekly window instead of showing 0% left', () => {
    const result = parseMinimaxRemains({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          current_interval_remaining_percent: 80,
          current_weekly_remaining_percent: 0,
          current_weekly_status: 0,
          model_name: 'general',
        },
      ],
    });
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]).toMatchObject({ remainingPercent: 80 });
  });

  it('maps status_code 1004 to authError and other codes to notOnPlan', () => {
    expect(parseMinimaxRemains({ base_resp: { status_code: 1004 } }).status).toBe('authError');
    expect(parseMinimaxRemains({ base_resp: { status_code: 2013 } })).toMatchObject({
      reason: 'notOnPlan',
      status: 'unavailable',
    });
  });
});

describe('minimaxUsageAdapter', () => {
  it('falls back to the legacy path only after a 404', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(REMAINS_FIXTURE), { status: 200 }));

    const result = await minimaxUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(result.status).toBe('ok');
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'https://www.minimax.io/v1/api/openplatform/coding_plan/remains',
    );
  });

  it('stops on an auth error without trying the legacy path', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const result = await minimaxUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(result.status).toBe('authError');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
