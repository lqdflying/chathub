import { bearer, requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asOptionalString,
  asRecord,
  completeWindow,
  parseTimestamp,
  safeOrigin,
  statusFromHttp,
} from '../parse';
import type {
  ProviderUsageAdapter,
  ProviderUsageAdapterResult,
  ProviderUsageWindow,
} from '../types';

/**
 * GLM Coding Plan quota (undocumented monitor endpoint, same on
 * open.bigmodel.cn and api.z.ai): GET {origin}/api/monitor/usage/quota/limit
 * Pay-as-you-go keys have no public balance API.
 * @see https://docs.rs/crate/quotas/latest/source/docs-usage/zai.md
 */
export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export const resolveZhipuQuotaUrl = (baseURL?: string) =>
  `${safeOrigin(baseURL, 'https://open.bigmodel.cn')}/api/monitor/usage/quota/limit`;

const WEEK_MINUTES = 7 * 24 * 60;

/**
 * `unit` 3 = hours and 5 = months. Community notes call 6 "weeks", but the
 * captured weekly row is `unit: 6, number: 7`, so both 6/1 and 6/7 mean one
 * week. The vendor `type` label ("5h Token", "Weekly Token") is the fallback.
 */
export const classifyZhipuWindow = (
  unit?: number,
  count?: number,
  typeLabel?: string,
): { kind: ProviderUsageWindow['kind']; minutes?: number } => {
  const n = count ?? 1;
  if (unit === 3 && n === 5) return { kind: 'fiveHour', minutes: 300 };
  if (unit === 6 && (n === 1 || n === 7)) return { kind: 'weekly', minutes: WEEK_MINUTES };
  if (unit === 5 && n === 1) return { kind: 'monthly' };

  const label = (typeLabel ?? '').toLowerCase();
  if (/\b5\s*h|5-hour|five/.test(label)) return { kind: 'fiveHour', minutes: 300 };
  if (label.includes('week')) return { kind: 'weekly', minutes: WEEK_MINUTES };
  if (label.includes('month')) return { kind: 'monthly' };
  if (label.includes('day') || label.includes('daily')) return { kind: 'daily', minutes: 1440 };
  if (unit === 3) return { kind: 'custom', minutes: n * 60 };
  return { kind: 'custom' };
};

export const parseZhipuQuota = (payload: unknown): ProviderUsageAdapterResult => {
  const root = asRecord(payload);
  const code = asFiniteNumber(root.code);
  if (root.success === false || (code !== undefined && code !== 200 && code !== 0)) {
    return { reason: 'notOnPlan', status: 'unavailable', unofficial: true };
  }

  const data = asRecord(root.data);
  const windows: ProviderUsageWindow[] = [];

  for (const raw of asArray(data.limits)) {
    const item = asRecord(raw);
    const rawType = asOptionalString(item.rawType)?.toUpperCase();
    const { kind, minutes } = classifyZhipuWindow(
      asFiniteNumber(item.unit),
      asFiniteNumber(item.number),
      asOptionalString(item.type),
    );
    const limit = asFiniteNumber(item.usage ?? item.total);
    const used = asFiniteNumber(item.currentValue);
    const remaining = asFiniteNumber(item.remaining);
    const usedPercent = asFiniteNumber(item.percentage);
    if (limit === undefined && usedPercent === undefined) continue;

    const isTokens = rawType === 'TOKENS_LIMIT';
    windows.push(
      completeWindow({
        kind,
        label: !isTokens && kind === 'monthly' ? 'MCP' : undefined,
        limit,
        remaining,
        resetsAt: parseTimestamp(item.nextResetTime),
        unit: isTokens ? 'tokens' : undefined,
        used,
        usedPercent,
        windowMinutes: minutes,
      }),
    );
  }

  if (windows.length === 0) {
    return { reason: 'notOnPlan', status: 'unavailable', unofficial: true };
  }

  const level = asOptionalString(data.level);
  return {
    plan: level && level.toLowerCase() !== 'unknown' ? level : undefined,
    status: 'ok',
    unofficial: true,
    windows,
  };
};

export const zhipuUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'apiKey',
  fetchUsage: async (context) => {
    const url = resolveZhipuQuotaUrl(context.credential.baseURL);
    const { apiKey } = context.credential;

    let response = await requestUsageJson(context, url, bearer(apiKey));
    // Community clients disagree on the Bearer prefix; retry once without it.
    if (response.status === 401) {
      response = await requestUsageJson(context, url, { Authorization: apiKey });
    }
    if (!response.ok) return { status: statusFromHttp(response.status), unofficial: true };
    return parseZhipuQuota(response.body);
  },
  provider: 'zhipu',
};
