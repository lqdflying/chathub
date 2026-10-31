import { bearer, requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asOptionalString,
  asRecord,
  statusFromHttp,
  stripVersionSuffix,
} from '../parse';
import type { ProviderUsageAdapter, ProviderUsageAdapterResult, ProviderUsageBalance } from '../types';

/**
 * Official: GET https://api.deepseek.com/user/balance
 * @see https://api-docs.deepseek.com/api/get-user-balance
 */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

export const resolveDeepSeekBalanceUrl = (baseURL?: string) =>
  `${stripVersionSuffix(baseURL || DEEPSEEK_DEFAULT_BASE_URL)}/user/balance`;

export const parseDeepSeekBalance = (payload: unknown): ProviderUsageAdapterResult => {
  const root = asRecord(payload);
  const balances: ProviderUsageBalance[] = [];

  for (const raw of asArray(root.balance_infos)) {
    const info = asRecord(raw);
    const total = asFiniteNumber(info.total_balance);
    if (total === undefined) continue;
    balances.push({
      currency: asOptionalString(info.currency) ?? 'CNY',
      granted: asFiniteNumber(info.granted_balance),
      paid: asFiniteNumber(info.topped_up_balance),
      total,
    });
  }

  const isAvailable = typeof root.is_available === 'boolean' ? root.is_available : undefined;
  if (balances.length === 0 && isAvailable === undefined) return { status: 'error' };

  return { balances, isAvailable, status: 'ok' };
};

export const deepseekUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'apiKey',
  fetchUsage: async (context) => {
    const response = await requestUsageJson(
      context,
      resolveDeepSeekBalanceUrl(context.credential.baseURL),
      bearer(context.credential.apiKey),
    );
    if (!response.ok) return { status: statusFromHttp(response.status) };
    return parseDeepSeekBalance(response.body);
  },
  provider: 'deepseek',
};
