import { bearer, requestUsageJson } from '../http';
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
 * OpenAI Costs API (Admin key only; project keys are rejected). There is no
 * public remaining-credit endpoint, so this reports month-to-date spend.
 * @see https://developers.openai.com/api/reference/resources/organization/subresources/audit_logs/methods/get_costs
 */
export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const MAX_PAGES = 3;

export const buildOpenAICostsUrl = (since: Date, page?: string) => {
  const params = new URLSearchParams({
    bucket_width: '1d',
    limit: '31',
    start_time: String(Math.floor(since.getTime() / 1000)),
  });
  if (page) params.set('page', page);
  return `${OPENAI_COSTS_URL}?${params.toString()}`;
};

/** Buckets carry `results[]` (also seen as a single `result`). */
export const sumOpenAICosts = (payload: unknown) => {
  const root = asRecord(payload);
  let amount = 0;
  let currency: string | undefined;
  let found = false;

  for (const rawBucket of asArray(root.data)) {
    const bucket = asRecord(rawBucket);
    const results = Array.isArray(bucket.results)
      ? bucket.results
      : bucket.result === undefined
        ? []
        : asArray(bucket.result).length > 0
          ? asArray(bucket.result)
          : [bucket.result];

    for (const rawResult of results) {
      const value = asRecord(asRecord(rawResult).amount);
      const numeric = asFiniteNumber(value.value);
      if (numeric === undefined) continue;
      amount += numeric;
      found = true;
      currency ??= asOptionalString(value.currency);
    }
  }

  return {
    amount,
    currency: (currency ?? 'usd').toUpperCase(),
    // A page of empty buckets still proves the key works.
    found: found || Array.isArray(root.data),
    nextPage: root.has_more === true ? asOptionalString(root.next_page) : undefined,
  };
};

export const openaiUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'admin',
  fetchUsage: async (context) => {
    const since = utcMonthStart(context.now);
    const auth = bearer(context.credential.apiKey);
    let total = 0;
    let currency = 'USD';
    let page: string | undefined;

    for (let index = 0; index < MAX_PAGES; index += 1) {
      const response = await requestUsageJson(context, buildOpenAICostsUrl(since, page), auth);
      if (!response.ok) return { status: statusFromHttp(response.status) };

      const sum = sumOpenAICosts(response.body);
      if (!sum.found) return { status: 'error' };
      total += sum.amount;
      currency = sum.currency;
      page = sum.nextPage;
      if (!page) break;
    }

    return {
      spend: { amount: Math.round(total * 100) / 100, currency, since: since.toISOString() },
      status: 'ok',
    };
  },
  provider: 'openai',
};
