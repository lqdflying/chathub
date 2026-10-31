export type UsageWindowKind = 'custom' | 'daily' | 'fiveHour' | 'monthly' | 'weekly';

export const PROVIDER_USAGE_STALE_MS = 60_000;

/** Currency amount; falls back to `12.34 XYZ` for codes Intl does not know. */
export const formatUsageMoney = (amount: number, currency: string, locale?: string) => {
  const code = currency.trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat(locale, {
      currency: code,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: 'currency',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
};

export const formatUsageCount = (value: number, locale?: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(value);

export const formatUsageTime = (iso?: string) => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
};

export const usageWindowTitleKey = (kind: UsageWindowKind) =>
  `providerUsage.window.${kind}` as const;

/** Same thresholds as the Codex / SuperGrok meters. */
export const resolveUsageStroke = (remainingPercent: number) => {
  if (remainingPercent >= 40) return 'success';
  if (remainingPercent >= 15) return 'normal';
  return 'exception';
};
