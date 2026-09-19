import type { OpenAICodexUsageWindow } from './types';

/**
 * Official Codex CLI classifies windows by duration, not by primary/secondary
 * slot. When the 5-hour meter is disabled, `primary_window` is the weekly
 * bucket and `secondary_window` is null.
 *
 * @see https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/rate_limits.rs
 * @see https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs
 * @see https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
 */
const FIVE_HOUR_MINUTES = 5 * 60;
const WEEKLY_MINUTES = 7 * 24 * 60;
const WINDOW_TOLERANCE = 0.05;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const isApproximateMinutes = (minutes: number, expected: number) =>
  minutes >= expected * (1 - WINDOW_TOLERANCE) && minutes <= expected * (1 + WINDOW_TOLERANCE);

/** Official Codex: `(limit_window_seconds + 59) / 60` integer division. */
export const windowMinutesFromSeconds = (seconds: number): number | undefined => {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.trunc((seconds + 59) / 60);
};

export const remainingPercentFromUsed = (usedPercent: number): number =>
  Math.max(0, Math.min(100, Math.round(100 - usedPercent)));

const parseWindow = (value: unknown): OpenAICodexUsageWindow | undefined => {
  const record = asRecord(value);
  const usedPercent = asFiniteNumber(record.used_percent);
  const windowSeconds = asFiniteNumber(record.limit_window_seconds);
  if (usedPercent === undefined || windowSeconds === undefined) return undefined;

  const windowMinutes = windowMinutesFromSeconds(windowSeconds);
  if (windowMinutes === undefined) return undefined;

  const resetAt = asFiniteNumber(record.reset_at);
  return {
    remainingPercent: remainingPercentFromUsed(usedPercent),
    resetsAt:
      resetAt !== undefined && resetAt > 0 ? new Date(resetAt * 1000).toISOString() : undefined,
    usedPercent,
    windowMinutes,
    windowSeconds,
  };
};

export const classifyOpenAICodexUsageWindow = (
  window: OpenAICodexUsageWindow,
): 'fiveHour' | 'weekly' | undefined => {
  if (isApproximateMinutes(window.windowMinutes, FIVE_HOUR_MINUTES)) return 'fiveHour';
  if (isApproximateMinutes(window.windowMinutes, WEEKLY_MINUTES)) return 'weekly';
  return undefined;
};

export const parseOpenAICodexUsageWindows = (
  payload: unknown,
): { fiveHour?: OpenAICodexUsageWindow; weekly?: OpenAICodexUsageWindow } => {
  const rateLimit = asRecord(asRecord(payload).rate_limit);
  const parsed: { fiveHour?: OpenAICodexUsageWindow; weekly?: OpenAICodexUsageWindow } = {};

  for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
    const window = parseWindow(raw);
    if (!window) continue;
    const kind = classifyOpenAICodexUsageWindow(window);
    if (!kind || parsed[kind]) continue;
    parsed[kind] = window;
  }

  return parsed;
};
