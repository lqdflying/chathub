import { describe, expect, it, vi } from 'vitest';

import {
  ANTHROPIC_ADMIN_API_VERSION,
  anthropicCostWindow,
  anthropicUsageAdapter,
  buildAnthropicCostReportUrl,
  sumAnthropicCostCents,
} from './anthropic';
import { buildOpenAICostsUrl, openaiUsageAdapter, sumOpenAICosts } from './openai';
import {
  XAI_MANAGEMENT_KEY_VALIDATION_URL,
  parseXaiManagementTeamId,
  parseXaiPrepaidBalance,
  resolveXaiPrepaidBalanceUrl,
  xaiUsageAdapter,
} from './xai';

const NOW = new Date('2026-10-31T12:00:00Z');
const MONTH_START = new Date('2026-10-01T00:00:00Z');

const context = (fetchFn: typeof fetch, teamId?: string) => ({
  credential: { apiKey: 'admin-test-key', teamId },
  fetchFn,
  now: NOW,
  resolveHost: async () => ['1.1.1.1'],
  timeoutMs: 1000,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('xAI management balance', () => {
  it('reads the inverted cents ledger from the documented example', () => {
    expect(parseXaiPrepaidBalance({ changes: [], total: { val: '-1000' } })).toEqual({
      balances: [{ currency: 'USD', total: 10 }],
      isAvailable: true,
      status: 'ok',
    });
  });

  it('renders an empty ledger as 0, not -0', () => {
    const result = parseXaiPrepaidBalance({ total: { val: '0' } });
    expect(Object.is(result.balances?.[0]?.total, 0)).toBe(true);
    expect(result.isAvailable).toBe(false);
  });

  it('treats a missing total as an error, not a zero balance', () => {
    expect(parseXaiPrepaidBalance({})).toEqual({ status: 'error' });
  });

  it('takes the team from a team-scoped key and never from an organization scope id', () => {
    expect(parseXaiManagementTeamId({ scope: 'SCOPE_TEAM', scopeId: 'team-1' })).toBe('team-1');
    expect(parseXaiManagementTeamId({ scope: 'SCOPE_ORGANIZATION', scopeId: 'org-1' })).toBe(
      undefined,
    );
    expect(parseXaiManagementTeamId({ scope: 'SCOPE_ORGANIZATION', teamId: 'team-9' })).toBe(
      'team-9',
    );
  });

  it('uses a saved team id directly', async () => {
    const fetchFn = vi.fn(async () => json({ total: { val: '-250' } }));
    const result = await xaiUsageAdapter.fetchUsage(context(fetchFn as never, 'team-a'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(resolveXaiPrepaidBalanceUrl('team-a'));
    expect(result.balances?.[0]?.total).toBe(2.5);
  });

  it('discovers the team id, or asks for it when the key is organization-scoped', async () => {
    const discovered = vi
      .fn()
      .mockResolvedValueOnce(json({ scope: 'SCOPE_TEAM', scopeId: 'team-z' }))
      .mockResolvedValueOnce(json({ total: { val: '-100' } }));
    await xaiUsageAdapter.fetchUsage(context(discovered as never));
    expect(discovered.mock.calls[0]?.[0]).toBe(XAI_MANAGEMENT_KEY_VALIDATION_URL);
    expect(discovered.mock.calls[1]?.[0]).toBe(resolveXaiPrepaidBalanceUrl('team-z'));

    const orgScoped = vi.fn(async () => json({ scope: 'SCOPE_ORGANIZATION', scopeId: 'org-1' }));
    await expect(xaiUsageAdapter.fetchUsage(context(orgScoped as never))).resolves.toEqual({
      reason: 'teamIdRequired',
      status: 'error',
    });
  });

  it('reports authError for a rejected key and error when validation is down', async () => {
    const denied = vi.fn(async () => new Response('', { status: 401 }));
    await expect(xaiUsageAdapter.fetchUsage(context(denied as never))).resolves.toEqual({
      status: 'authError',
    });

    const outage = vi.fn(async () => new Response('', { status: 500 }));
    await expect(xaiUsageAdapter.fetchUsage(context(outage as never))).resolves.toEqual({
      status: 'error',
    });
  });
});

describe('OpenAI costs', () => {
  it('requests daily buckets from the UTC month start', () => {
    const url = new URL(buildOpenAICostsUrl(MONTH_START, 'page_2'));
    expect(url.origin + url.pathname).toBe('https://api.openai.com/v1/organization/costs');
    expect(url.searchParams.get('start_time')).toBe(String(MONTH_START.getTime() / 1000));
    expect(url.searchParams.get('bucket_width')).toBe('1d');
    expect(url.searchParams.get('page')).toBe('page_2');
  });

  it('sums results[] and the single result shape', () => {
    expect(
      sumOpenAICosts({
        data: [
          { results: [{ amount: { currency: 'usd', value: 0.06 } }] },
          { result: { amount: { currency: 'usd', value: 1.5 } } },
          { results: [] },
        ],
        has_more: false,
      }),
    ).toEqual({ amount: 1.56, currency: 'USD', found: true, nextPage: undefined });
  });

  it('follows next_page and reports month-to-date spend', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          data: [{ results: [{ amount: { currency: 'usd', value: 2 } }] }],
          has_more: true,
          next_page: 'p2',
        }),
      )
      .mockResolvedValueOnce(
        json({ data: [{ results: [{ amount: { currency: 'usd', value: 0.505 } }] }] }),
      );
    const result = await openaiUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer admin-test-key',
    });
    expect(result).toEqual({
      spend: { amount: 2.51, currency: 'USD', since: MONTH_START.toISOString() },
      status: 'ok',
    });
  });

  it('maps a rejected project key to authError', async () => {
    const fetchFn = vi.fn(async () => json({ error: {} }, 403));
    await expect(openaiUsageAdapter.fetchUsage(context(fetchFn as never))).resolves.toEqual({
      status: 'authError',
    });
  });
});

describe('Anthropic cost report', () => {
  it('requests closed days and skips a range that starts today', () => {
    const midMonth = anthropicCostWindow(new Date('2026-10-31T12:00:00Z'));
    const midUrl = new URL(buildAnthropicCostReportUrl(midMonth.queryStart, midMonth.queryEnd));
    expect(midUrl.searchParams.get('starting_at')).toBe('2026-10-01T00:00:00Z');
    expect(midUrl.searchParams.get('ending_at')).toBe('2026-11-01T00:00:00Z');

    const firstDay = anthropicCostWindow(new Date('2026-11-01T02:33:00Z'));
    const firstUrl = new URL(buildAnthropicCostReportUrl(firstDay.queryStart, firstDay.queryEnd));
    expect(firstUrl.searchParams.get('starting_at')).toBe('2026-10-31T00:00:00Z');
    expect(firstUrl.searchParams.get('ending_at')).toBe('2026-11-02T00:00:00Z');
    expect(firstDay.since.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('ignores buckets from before this month', () => {
    expect(
      sumAnthropicCostCents(
        {
          data: [
            { results: [{ amount: '50', currency: 'USD' }], starting_at: '2026-10-31T00:00:00Z' },
            { results: [{ amount: '25', currency: 'USD' }], starting_at: '2026-11-01T00:00:00Z' },
          ],
          has_more: false,
        },
        Date.parse('2026-11-01T00:00:00Z'),
      ),
    ).toMatchObject({ cents: 25, found: true });
  });

  it('sums decimal-string cents across buckets', () => {
    expect(
      sumAnthropicCostCents({
        data: [
          { results: [{ amount: '123.45', currency: 'USD' }] },
          { results: [{ amount: '76.55', currency: 'USD' }] },
        ],
        has_more: false,
      }),
    ).toEqual({ cents: 200, currency: 'USD', found: true, nextPage: undefined });
  });

  it('sends x-api-key with the API version and converts cents to dollars', async () => {
    const fetchFn = vi.fn(async () =>
      json({ data: [{ results: [{ amount: '1050', currency: 'USD' }] }], has_more: false }),
    );
    const result = await anthropicUsageAdapter.fetchUsage(context(fetchFn as never));
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer admin-test-key',
      'anthropic-version': ANTHROPIC_ADMIN_API_VERSION,
      'x-api-key': 'admin-test-key',
    });
    expect(result.spend).toEqual({
      amount: 10.5,
      currency: 'USD',
      since: MONTH_START.toISOString(),
    });
  });
});
