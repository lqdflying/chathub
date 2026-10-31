import { bearer, requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asRecord,
  classifyWindowMinutes,
  completeWindow,
  parseTimestamp,
  safeHostname,
  statusFromHttp,
  stripVersionSuffix,
} from '../parse';
import type {
  ProviderUsageAdapter,
  ProviderUsageAdapterResult,
  ProviderUsageWindow,
} from '../types';

/**
 * Pay-as-you-go balance (official): GET {base}/v1/users/me/balance
 * @see https://platform.moonshot.ai/docs/api/balance
 *
 * Kimi Code plan (undocumented; from the open-source kimi-cli):
 * GET https://api.kimi.com/coding/v1/usages
 * @see https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/ui/shell/usage.py
 */
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';
const KIMI_CODE_HOST = 'api.kimi.com';

export const isKimiCodeBaseURL = (baseURL?: string) => safeHostname(baseURL) === KIMI_CODE_HOST;

/** Keys are platform-scoped, so the API host decides the account currency. */
export const resolveMoonshotCurrency = (baseURL?: string) =>
  (safeHostname(baseURL || MOONSHOT_DEFAULT_BASE_URL) ?? '').endsWith('.cn') ? 'CNY' : 'USD';

export const resolveMoonshotBalanceUrl = (baseURL?: string) =>
  `${stripVersionSuffix(baseURL || MOONSHOT_DEFAULT_BASE_URL)}/v1/users/me/balance`;

export const resolveKimiCodeUsagesUrl = (baseURL: string) =>
  `${stripVersionSuffix(baseURL)}/v1/usages`;

export const parseMoonshotBalance = (
  payload: unknown,
  currency: string,
): ProviderUsageAdapterResult => {
  const root = asRecord(payload);
  if (root.status === false) return { status: 'error' };

  const data = asRecord(root.data);
  const available = asFiniteNumber(data.available_balance);
  if (available === undefined) return { status: 'error' };

  return {
    balances: [
      {
        currency,
        granted: asFiniteNumber(data.voucher_balance),
        paid: asFiniteNumber(data.cash_balance),
        total: available,
      },
    ],
    isAvailable: available > 0,
    status: 'ok',
  };
};

const TIME_UNIT_MINUTES: Record<string, number> = {
  DAY: 24 * 60,
  HOUR: 60,
  MINUTE: 1,
  SECOND: 1 / 60,
};

const windowMinutes = (window: Record<string, unknown>): number | undefined => {
  const duration = asFiniteNumber(window.duration);
  if (duration === undefined) return undefined;
  const unit = String(window.timeUnit ?? window.time_unit ?? '')
    .toUpperCase()
    .replace(/^TIME_UNIT_/, '');
  const factor = TIME_UNIT_MINUTES[unit];
  return factor === undefined ? undefined : Math.round(duration * factor);
};

const parseKimiDetail = (
  detail: Record<string, unknown>,
  kind: ProviderUsageWindow['kind'],
  minutes?: number,
): ProviderUsageWindow | undefined => {
  const limit = asFiniteNumber(detail.limit);
  const remaining = asFiniteNumber(detail.remaining);
  const used = asFiniteNumber(detail.used);
  if (limit === undefined || (remaining === undefined && used === undefined)) return undefined;
  return completeWindow({
    kind,
    limit,
    remaining,
    resetsAt: parseTimestamp(
      detail.resetTime ?? detail.reset_time ?? detail.resetAt ?? detail.reset_at,
    ),
    used,
    windowMinutes: minutes,
  });
};

/**
 * `usage` is the weekly bucket; `limits[]` carries sliding windows (5 hours).
 * Numbers may be strings and `used` may be absent, so `remaining` wins.
 */
export const parseKimiCodeUsages = (payload: unknown): ProviderUsageAdapterResult => {
  const root = asRecord(payload);
  const windows: ProviderUsageWindow[] = [];

  for (const raw of asArray(root.limits)) {
    const item = asRecord(raw);
    const minutes = windowMinutes(asRecord(item.window));
    const window = parseKimiDetail(asRecord(item.detail), classifyWindowMinutes(minutes), minutes);
    if (window) windows.push(window);
  }

  const weekly = parseKimiDetail(asRecord(root.usage), 'weekly');
  if (weekly) windows.push(weekly);

  if (windows.length === 0) return { status: 'error', unofficial: true };
  return { status: 'ok', unofficial: true, windows };
};

export const moonshotUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'apiKey',
  fetchUsage: async (context) => {
    const { apiKey, baseURL } = context.credential;

    if (baseURL && isKimiCodeBaseURL(baseURL)) {
      const response = await requestUsageJson(
        context,
        resolveKimiCodeUsagesUrl(baseURL),
        bearer(apiKey),
      );
      if (!response.ok) return { status: statusFromHttp(response.status), unofficial: true };
      return parseKimiCodeUsages(response.body);
    }

    const response = await requestUsageJson(
      context,
      resolveMoonshotBalanceUrl(baseURL),
      bearer(apiKey),
    );
    if (!response.ok) return { status: statusFromHttp(response.status) };
    return parseMoonshotBalance(response.body, resolveMoonshotCurrency(baseURL));
  },
  provider: 'moonshot',
};
