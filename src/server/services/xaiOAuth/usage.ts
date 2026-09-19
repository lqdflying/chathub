import type { XaiOAuthUsageWindow } from './types';

const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WINDOW_TOLERANCE = 0.2;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const remainingPercentFromUsed = (usedPercent: number): number =>
  Math.max(0, Math.min(100, Math.round(100 - usedPercent)));

const parseDate = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
};

const periodLabel = (type?: string, monthlyLimit?: number): XaiOAuthUsageWindow['label'] => {
  const normalized = (type ?? '').toUpperCase();
  if (normalized.includes('WEEKLY')) return 'Weekly';
  if (normalized.includes('MONTHLY') || monthlyLimit !== undefined) return 'Monthly';
  return 'Usage';
};

const isFiveHourWindow = (windowSeconds?: number) => {
  if (windowSeconds === undefined) return false;
  return (
    windowSeconds >= FIVE_HOUR_SECONDS * (1 - WINDOW_TOLERANCE) &&
    windowSeconds <= FIVE_HOUR_SECONDS * (1 + WINDOW_TOLERANCE)
  );
};

const parsePercent = (value: unknown): number | undefined => {
  const parsed = asFiniteNumber(value);
  if (parsed === undefined || parsed < 0) return undefined;
  return clampPercent(parsed);
};

const parseWindowFromConfig = (config: Record<string, unknown>): XaiOAuthUsageWindow | undefined => {
  const currentPeriod = asRecord(config.currentPeriod ?? config.current_period);
  const explicitPercent = parsePercent(config.creditUsagePercent ?? config.credit_usage_percent);
  const used = asFiniteNumber(config.used);
  const monthlyLimit = asFiniteNumber(config.monthlyLimit ?? config.monthly_limit);
  const legacyPercent =
    used !== undefined && monthlyLimit !== undefined && monthlyLimit > 0 && used >= 0
      ? parsePercent((used / monthlyLimit) * 100)
      : undefined;
  const percent = explicitPercent ?? legacyPercent;
  if (percent === undefined) return undefined;

  return {
    label: periodLabel(asOptionalString(currentPeriod.type), monthlyLimit),
    remainingPercent: remainingPercentFromUsed(percent),
    resetsAt: parseDate(
      currentPeriod.end ?? config.billingPeriodEnd ?? config.billing_period_end,
    ),
    usedPercent: percent,
  };
};

const parseExtraWindow = (value: unknown): XaiOAuthUsageWindow | undefined => {
  const record = asRecord(value);
  const usedPercent = parsePercent(
    record.usedPercent ?? record.used_percent ?? record.creditUsagePercent,
  );
  if (usedPercent === undefined) return undefined;

  const windowSeconds = asFiniteNumber(
    record.windowSeconds ?? record.window_seconds ?? record.limit_window_seconds ?? record.duration,
  );
  return {
    label: periodLabel(asOptionalString(record.type ?? record.label), undefined),
    remainingPercent: remainingPercentFromUsed(usedPercent),
    resetsAt: parseDate(record.end ?? record.resetsAt ?? record.reset_at ?? record.resetAt),
    usedPercent,
    windowMinutes: windowSeconds === undefined ? undefined : Math.round(windowSeconds / 60),
    windowSeconds,
  };
};

/**
 * SuperGrok billing is a weekly (or monthly) pool. A 5-hour meter is only
 * returned when the payload actually includes a second ~5-hour window.
 */
export const parseXaiUsageWindows = (
  payload: unknown,
): { fiveHour?: XaiOAuthUsageWindow; weekly?: XaiOAuthUsageWindow } => {
  const root = asRecord(payload);
  const config = asRecord(root.config);
  const parsed: { fiveHour?: XaiOAuthUsageWindow; weekly?: XaiOAuthUsageWindow } = {};

  const primary = parseWindowFromConfig(config);
  if (primary) {
    if (isFiveHourWindow(primary.windowSeconds)) parsed.fiveHour = primary;
    else parsed.weekly = primary;
  }

  const extras = [
    config.fiveHour,
    config.five_hour,
    config.shortPeriod,
    config.short_period,
    ...(Array.isArray(config.windows) ? config.windows : []),
    ...(Array.isArray(root.windows) ? root.windows : []),
  ];

  for (const extra of extras) {
    const window = parseExtraWindow(extra);
    if (!window || !isFiveHourWindow(window.windowSeconds) || parsed.fiveHour) continue;
    parsed.fiveHour = window;
  }

  return parsed;
};
