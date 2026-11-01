import { requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asOptionalString,
  asRecord,
  statusFromHttp,
  utcMonthStart,
} from '../parse';
import type { ProviderUsageAdapter } from '../types';

/**
 * Anthropic Usage and Cost Admin API (Admin key `sk-ant-admin...`). Amounts
 * are decimal strings in cents; there is no remaining-credit endpoint, so
 * this reports month-to-date spend. The endpoint is marked legacy in favor of
 * the Analytics API but remains documented.
 * @see https://platform.claude.com/docs/en/api/admin/cost_report/retrieve
 * The current example uses `anthropic-version: 2026-10-21` and
 * `Authorization: Bearer`. `starting_at` is RFC 3339 without fractional seconds.
 */
export const ANTHROPIC_COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
export const ANTHROPIC_ADMIN_API_VERSION = '2026-10-21';
const MAX_PAGES = 3;

/** RFC 3339 UTC without fractional seconds, matching the Admin API examples. */
const toAnthropicTimestamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const DAY_MS = 86_400_000;

/**
 * Anthropic rejects a range that starts on the current UTC day: a future
 * `ending_at` is snapped back to today 00:00, which is then not after
 * `starting_at`. On the 1st, query the previous day so the key is still
 * checked, and keep `since` as the month start for the sum.
 */
export const anthropicCostWindow = (now: Date) => {
  const since = utcMonthStart(now);
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const queryEnd = new Date(startOfToday.getTime() + DAY_MS);
  const queryStart =
    since.getTime() < startOfToday.getTime() ? since : new Date(startOfToday.getTime() - DAY_MS);
  return { queryEnd, queryStart, since };
};

export const buildAnthropicCostReportUrl = (start: Date, end: Date, page?: string) => {
  const params = new URLSearchParams({
    bucket_width: '1d',
    ending_at: toAnthropicTimestamp(end),
    limit: '31',
    starting_at: toAnthropicTimestamp(start),
  });
  if (page) params.set('page', page);
  return `${ANTHROPIC_COST_REPORT_URL}?${params.toString()}`;
};

export const sumAnthropicCostCents = (payload: unknown, sinceMs?: number) => {
  const root = asRecord(payload);
  let cents = 0;
  let currency: string | undefined;

  for (const rawBucket of asArray(root.data)) {
    const bucket = asRecord(rawBucket);
    const bucketStart = Date.parse(asOptionalString(bucket.starting_at) ?? '');
    if (sinceMs !== undefined && Number.isFinite(bucketStart) && bucketStart < sinceMs) continue;

    for (const rawResult of asArray(bucket.results)) {
      const result = asRecord(rawResult);
      const amount = asFiniteNumber(result.amount);
      if (amount === undefined) continue;
      cents += amount;
      currency ??= asOptionalString(result.currency);
    }
  }

  return {
    cents,
    currency: (currency ?? 'USD').toUpperCase(),
    found: Array.isArray(root.data),
    nextPage: root.has_more === true ? asOptionalString(root.next_page) : undefined,
  };
};

export const anthropicUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'admin',
  fetchUsage: async (context) => {
    const { queryEnd, queryStart, since } = anthropicCostWindow(context.now);
    const headers = {
      Authorization: `Bearer ${context.credential.apiKey}`,
      'anthropic-version': ANTHROPIC_ADMIN_API_VERSION,
      'x-api-key': context.credential.apiKey,
    };
    let totalCents = 0;
    let currency = 'USD';
    let page: string | undefined;

    for (let index = 0; index < MAX_PAGES; index += 1) {
      const response = await requestUsageJson(
        context,
        buildAnthropicCostReportUrl(queryStart, queryEnd, page),
        headers,
      );
      if (!response.ok) return { status: statusFromHttp(response.status) };

      const sum = sumAnthropicCostCents(response.body, since.getTime());
      if (!sum.found) return { status: 'error' };
      totalCents += sum.cents;
      currency = sum.currency;
      page = sum.nextPage;
      if (!page) break;
    }

    return {
      spend: { amount: Math.round(totalCents) / 100, currency, since: since.toISOString() },
      status: 'ok',
    };
  },
  provider: 'anthropic',
};
