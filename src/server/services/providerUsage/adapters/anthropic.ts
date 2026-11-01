import { requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asOptionalString,
  asRecord,
  statusFromHttp,
  utcMonthStart,
} from '../parse';
import type {
  ProviderUsageAdapter,
  ProviderUsageFetchContext,
  ProviderUsageTokens,
} from '../types';

/**
 * Anthropic Usage and Cost Admin API (Admin key `sk-ant-admin...`). Amounts
 * are decimal strings in cents; there is no remaining-credit endpoint, so
 * this reports month-to-date spend, plus 7-day token use from the Analytics
 * API. The cost report is marked legacy in favor of the Analytics API but
 * remains documented.
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

/**
 * Usage and Cost Analytics API (beta). An Admin key gets HTTP 403 "missing
 * read:analytics" unless the beta header is sent. Without `bucket_width` the
 * whole range is one bucket with one row per group.
 * @see https://platform.claude.com/docs/en/manage-claude/usage-cost-api
 */
export const ANTHROPIC_ANALYTICS_USAGE_URL =
  'https://api.anthropic.com/v1/organizations/analytics/usage';
export const ANTHROPIC_ANALYTICS_COST_URL =
  'https://api.anthropic.com/v1/organizations/analytics/cost';
export const ANTHROPIC_ANALYTICS_BETA = 'analytics-usage-cost-2026-08-24';
const TOKEN_WINDOW_MS = 7 * DAY_MS;

export const buildAnthropicAnalyticsUrl = (base: string, since: Date, groupBy: string[]) => {
  const params = new URLSearchParams({ starting_at: toAnthropicTimestamp(since) });
  for (const dimension of groupBy) params.append('group_by[]', dimension);
  return `${base}?${params.toString()}`;
};

type CacheCounts = { read: number; uncached: number; write1h: number; write5m: number };

const COST_TOKEN_TYPES = new Map<string, keyof CacheCounts>([
  ['cache_creation.ephemeral_1h_input_tokens', 'write1h'],
  ['cache_creation.ephemeral_5m_input_tokens', 'write5m'],
  ['cache_read_input_tokens', 'read'],
  ['uncached_input_tokens', 'uncached'],
]);

/** Cache writes bill at these multiples of the base input price on every model. */
const WRITE_5M_MULTIPLIER = 1.25;
const WRITE_1H_MULTIPLIER = 2;

/**
 * Cache-read discounts differ by model (0.025× to 0.1×), so the base input
 * price comes from the model's own uncached-input and cache-write cost
 * instead of a price table. A model with no uncached input or writes in the
 * window cannot be priced and adds nothing.
 */
const netCacheSavingsCents = (tokens: CacheCounts, cents: CacheCounts) => {
  const baseTokens = tokens.uncached + tokens.write5m + tokens.write1h;
  if (baseTokens === 0) return 0;
  const baseUnitCents =
    (cents.uncached + cents.write5m / WRITE_5M_MULTIPLIER + cents.write1h / WRITE_1H_MULTIPLIER) /
    baseTokens;
  const cachedTokens = tokens.read + tokens.write5m + tokens.write1h;
  return cachedTokens * baseUnitCents - (cents.read + cents.write5m + cents.write1h);
};

/** `usagePayload` is grouped by model; `costPayload` by model and token type, in cents. */
export const summarizeAnthropicTokens = (
  usagePayload: unknown,
  costPayload?: unknown,
): ProviderUsageTokens | undefined => {
  const usageRows = asRecord(usagePayload).data;
  if (!Array.isArray(usageRows)) return undefined;

  const tokensByModel = new Map<string, CacheCounts>();
  let total = 0;
  let read = 0;
  let uncached = 0;
  for (const rawRow of usageRows) {
    const row = asRecord(rawRow);
    const usage = asRecord(row.usage);
    const creation = asRecord(usage.cache_creation);
    const counts = {
      read: asFiniteNumber(usage.cache_read_input_tokens) ?? 0,
      uncached: asFiniteNumber(usage.uncached_input_tokens) ?? 0,
      write1h: asFiniteNumber(creation.ephemeral_1h_input_tokens) ?? 0,
      write5m: asFiniteNumber(creation.ephemeral_5m_input_tokens) ?? 0,
    };
    total +=
      counts.read +
      counts.uncached +
      counts.write1h +
      counts.write5m +
      (asFiniteNumber(usage.output_tokens) ?? 0);
    read += counts.read;
    uncached += counts.uncached;
    const model = asOptionalString(asRecord(row.group).model);
    if (model) tokensByModel.set(model, counts);
  }

  let cacheSavings: ProviderUsageTokens['cacheSavings'];
  const costRows = asRecord(costPayload).data;
  if (Array.isArray(costRows)) {
    const centsByModel = new Map<string, CacheCounts>();
    let currency: string | undefined;
    for (const rawRow of costRows) {
      const row = asRecord(rawRow);
      const group = asRecord(row.group);
      const cost = asRecord(row.cost);
      const model = asOptionalString(group.model);
      const field = COST_TOKEN_TYPES.get(asOptionalString(group.token_type) ?? '');
      const amount = asFiniteNumber(cost.amount);
      if (!model || !field || amount === undefined) continue;
      const cents = centsByModel.get(model) ?? { read: 0, uncached: 0, write1h: 0, write5m: 0 };
      cents[field] += amount;
      centsByModel.set(model, cents);
      currency ??= asOptionalString(cost.currency);
    }
    let savedCents = 0;
    for (const [model, tokens] of tokensByModel) {
      const cents = centsByModel.get(model);
      if (cents) savedCents += netCacheSavingsCents(tokens, cents);
    }
    cacheSavings = {
      amount: Math.round(savedCents) / 100,
      currency: (currency ?? 'USD').toUpperCase(),
    };
  }

  return {
    ...(read + uncached > 0
      ? { cacheHitPercent: Math.round((read / (read + uncached)) * 100) }
      : {}),
    ...(cacheSavings ? { cacheSavings } : {}),
    total,
  };
};

/** Best effort: a failure here leaves out `tokens` and never changes the spend status. */
const fetchAnthropicTokens = async (
  context: ProviderUsageFetchContext,
  headers: Record<string, string>,
) => {
  const since = new Date(context.now.getTime() - TOKEN_WINDOW_MS);
  const analyticsHeaders = { ...headers, 'anthropic-beta': ANTHROPIC_ANALYTICS_BETA };
  const [usage, cost] = await Promise.all([
    requestUsageJson(
      context,
      buildAnthropicAnalyticsUrl(ANTHROPIC_ANALYTICS_USAGE_URL, since, ['model']),
      analyticsHeaders,
    ),
    requestUsageJson(
      context,
      buildAnthropicAnalyticsUrl(ANTHROPIC_ANALYTICS_COST_URL, since, ['model', 'token_type']),
      analyticsHeaders,
    ).catch(() => undefined),
  ]);
  if (!usage.ok) return undefined;
  return summarizeAnthropicTokens(usage.body, cost?.ok ? cost.body : undefined);
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
    const tokensPromise = fetchAnthropicTokens(context, headers).catch(() => undefined);
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

    const tokens = await tokensPromise;
    return {
      spend: { amount: Math.round(totalCents) / 100, currency, since: since.toISOString() },
      status: 'ok',
      ...(tokens ? { tokens } : {}),
    };
  },
  provider: 'anthropic',
};
