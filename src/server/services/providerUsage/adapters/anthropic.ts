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
 * @see https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
 * @see https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report
 */
export const ANTHROPIC_COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
export const ANTHROPIC_ADMIN_API_VERSION = '2023-06-01';
const MAX_PAGES = 3;

export const buildAnthropicCostReportUrl = (since: Date, page?: string) => {
  const params = new URLSearchParams({
    bucket_width: '1d',
    limit: '31',
    starting_at: since.toISOString(),
  });
  if (page) params.set('page', page);
  return `${ANTHROPIC_COST_REPORT_URL}?${params.toString()}`;
};

export const sumAnthropicCostCents = (payload: unknown) => {
  const root = asRecord(payload);
  let cents = 0;
  let currency: string | undefined;

  for (const rawBucket of asArray(root.data)) {
    for (const rawResult of asArray(asRecord(rawBucket).results)) {
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
    const since = utcMonthStart(context.now);
    const headers = {
      'anthropic-version': ANTHROPIC_ADMIN_API_VERSION,
      'x-api-key': context.credential.apiKey,
    };
    let totalCents = 0;
    let currency = 'USD';
    let page: string | undefined;

    for (let index = 0; index < MAX_PAGES; index += 1) {
      const response = await requestUsageJson(
        context,
        buildAnthropicCostReportUrl(since, page),
        headers,
      );
      if (!response.ok) return { status: statusFromHttp(response.status) };

      const sum = sumAnthropicCostCents(response.body);
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
