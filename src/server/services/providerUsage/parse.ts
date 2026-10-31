import type { ProviderUsageStatus, ProviderUsageWindow } from './types';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Accepts numbers and numeric strings ("12.50"), which several vendors use. */
export const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

/** Epoch seconds or milliseconds, or an ISO string, to ISO. */
export const parseTimestamp = (value: unknown): string | undefined => {
  const numeric = typeof value === 'number' ? value : undefined;
  if (numeric !== undefined && Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1e11 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return parseTimestamp(asNumber);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
};

/**
 * Fill whichever of used / remaining / percentages the vendor omitted, from
 * the fields it did send. Percentages are rounded to whole numbers.
 */
export const completeWindow = (window: ProviderUsageWindow): ProviderUsageWindow => {
  const { limit } = window;
  let { remaining, used, usedPercent, remainingPercent } = window;

  if (limit !== undefined && limit > 0) {
    if (used === undefined && remaining !== undefined) used = Math.max(0, limit - remaining);
    if (remaining === undefined && used !== undefined) remaining = Math.max(0, limit - used);
    if (usedPercent === undefined && used !== undefined) usedPercent = (used / limit) * 100;
  }
  if (usedPercent === undefined && remainingPercent !== undefined) {
    usedPercent = 100 - remainingPercent;
  }
  if (usedPercent !== undefined) usedPercent = Math.round(clampPercent(usedPercent));
  if (remainingPercent === undefined && usedPercent !== undefined) {
    remainingPercent = 100 - usedPercent;
  }
  if (remainingPercent !== undefined) remainingPercent = Math.round(clampPercent(remainingPercent));

  return {
    ...window,
    ...(remaining === undefined ? {} : { remaining }),
    ...(remainingPercent === undefined ? {} : { remainingPercent }),
    ...(used === undefined ? {} : { used }),
    ...(usedPercent === undefined ? {} : { usedPercent }),
  };
};

const FIVE_HOUR_MINUTES = 5 * 60;
const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;
const WINDOW_TOLERANCE = 0.2;

const isApproximately = (minutes: number, expected: number) =>
  minutes >= expected * (1 - WINDOW_TOLERANCE) && minutes <= expected * (1 + WINDOW_TOLERANCE);

export const classifyWindowMinutes = (minutes?: number): ProviderUsageWindow['kind'] => {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return 'custom';
  if (isApproximately(minutes, FIVE_HOUR_MINUTES)) return 'fiveHour';
  if (isApproximately(minutes, DAY_MINUTES)) return 'daily';
  if (isApproximately(minutes, WEEK_MINUTES)) return 'weekly';
  if (minutes >= 27 * DAY_MINUTES && minutes <= 32 * DAY_MINUTES) return 'monthly';
  return 'custom';
};

export const statusFromHttp = (httpStatus: number): ProviderUsageStatus => {
  if (httpStatus === 401 || httpStatus === 403) return 'authError';
  if (httpStatus === 404) return 'unavailable';
  return 'error';
};

/** Last four characters only, so a hint never reveals a usable key. */
export const toKeyHint = (key: string): string => {
  const trimmed = key.trim();
  return trimmed.length <= 8 ? '****' : `****${trimmed.slice(-4)}`;
};

/** First entry of a comma-separated key list, matching chat runtime parsing. */
export const firstKey = (value?: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.split(',')[0]?.trim() || undefined;
};

/** Start of the current UTC month. */
export const utcMonthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/** Base URL without trailing slashes and without a trailing `/v1` segment. */
export const stripVersionSuffix = (baseURL: string) =>
  trimTrailingSlashes(trimTrailingSlashes(baseURL).replace(/\/v1$/, ''));

export const safeHostname = (baseURL?: string): string | undefined => {
  if (!baseURL) return undefined;
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

export const safeOrigin = (baseURL: string | undefined, fallback: string): string => {
  if (!baseURL) return fallback;
  try {
    return new URL(baseURL).origin;
  } catch {
    return fallback;
  }
};
