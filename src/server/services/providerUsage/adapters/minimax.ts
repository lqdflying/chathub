import { bearer, requestUsageJson } from '../http';
import {
  asArray,
  asFiniteNumber,
  asOptionalString,
  asRecord,
  classifyWindowMinutes,
  completeWindow,
  parseTimestamp,
  safeHostname,
  statusFromHttp,
} from '../parse';
import type {
  ProviderUsageAdapter,
  ProviderUsageAdapterResult,
  ProviderUsageWindow,
} from '../types';

/**
 * M Plan / Token Plan remaining quota. The endpoint is in the official FAQ;
 * the response fields are only known from community clients.
 * @see https://platform.minimax.io/docs/coding-plan/faq ("How can I check M Plan usage?")
 * @see https://docs.rs/crate/tokmesh-cli/0.1.1/source/src/commands/usage/minimax_tokenplan.rs
 *
 * Pay-as-you-go keys have no public balance API.
 */
const MINIMAX_GLOBAL_SITE = 'https://www.minimax.io';
const MINIMAX_CN_SITE = 'https://www.minimaxi.com';
const TOKEN_PLAN_PATH = '/v1/token_plan/remains';
/** Older path still used by some clients. */
const LEGACY_CODING_PLAN_PATH = '/v1/api/openplatform/coding_plan/remains';
const MINIMAX_AUTH_ERROR_CODE = 1004;

const isMinimaxiHost = (hostname: string) =>
  hostname === 'minimaxi.com' || hostname.endsWith('.minimaxi.com');

export const resolveMinimaxSite = (baseURL?: string) =>
  isMinimaxiHost(safeHostname(baseURL) ?? '') ? MINIMAX_CN_SITE : MINIMAX_GLOBAL_SITE;

export const resolveMinimaxRemainsUrls = (baseURL?: string) => {
  const site = resolveMinimaxSite(baseURL);
  return [`${site}${TOKEN_PLAN_PATH}`, `${site}${LEGACY_CODING_PLAN_PATH}`];
};

const toMs = (value: unknown) => {
  const numeric = asFiniteNumber(value);
  if (numeric === undefined || numeric <= 0) return undefined;
  return numeric > 1e11 ? numeric : numeric * 1000;
};

const durationMinutes = (start: unknown, end: unknown) => {
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (startMs === undefined || endMs === undefined || endMs <= startMs) return undefined;
  return Math.round((endMs - startMs) / 60_000);
};

const PRIMARY_MODEL = 'general';

export const parseMinimaxRemains = (payload: unknown): ProviderUsageAdapterResult => {
  const root = asRecord(payload);
  const statusCode = asFiniteNumber(asRecord(root.base_resp).status_code);
  if (statusCode === MINIMAX_AUTH_ERROR_CODE) return { status: 'authError', unofficial: true };
  if (statusCode !== undefined && statusCode !== 0) {
    return { reason: 'notOnPlan', status: 'unavailable', unofficial: true };
  }

  const windows: ProviderUsageWindow[] = [];
  for (const raw of asArray(root.model_remains)) {
    const item = asRecord(raw);
    const model = asOptionalString(item.model_name);
    const label = model && model !== PRIMARY_MODEL ? model : undefined;

    const intervalPercent = asFiniteNumber(item.current_interval_remaining_percent);
    if (intervalPercent !== undefined) {
      const minutes = durationMinutes(item.start_time, item.end_time);
      windows.push(
        completeWindow({
          kind: classifyWindowMinutes(minutes),
          label,
          remainingPercent: intervalPercent,
          resetsAt: parseTimestamp(item.end_time),
          windowMinutes: minutes,
        }),
      );
    }

    // A zero weekly status means the plan has no weekly limit; skip it so
    // it never reads as "0% left".
    const weeklyStatus = asFiniteNumber(item.current_weekly_status);
    const weeklyPercent = asFiniteNumber(item.current_weekly_remaining_percent);
    if (weeklyStatus !== undefined && weeklyStatus !== 0 && weeklyPercent !== undefined) {
      windows.push(
        completeWindow({
          kind: 'weekly',
          label,
          remainingPercent: weeklyPercent,
          resetsAt: parseTimestamp(item.weekly_end_time),
        }),
      );
    }
  }

  if (windows.length === 0) {
    return { reason: 'notOnPlan', status: 'unavailable', unofficial: true };
  }
  return { status: 'ok', unofficial: true, windows };
};

export const minimaxUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'apiKey',
  fetchUsage: async (context) => {
    const headers = { ...bearer(context.credential.apiKey), 'Content-Type': 'application/json' };
    let lastStatus = 0;

    for (const url of resolveMinimaxRemainsUrls(context.credential.baseURL)) {
      const response = await requestUsageJson(context, url, headers);
      if (response.ok) return parseMinimaxRemains(response.body);
      lastStatus = response.status;
      if (response.status !== 404) break;
    }

    return { status: statusFromHttp(lastStatus), unofficial: true };
  },
  provider: 'minimax',
};
