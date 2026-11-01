import type { SandboxProfileItem } from '@lobechat/types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Hours and minutes; 0 ms means "no limit" or "per call" depending on the field. */
export const formatDuration = (ms: number): { hours: number; minutes: number } | undefined => {
  if (ms <= 0) return undefined;
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  if (hours && minutes) return { hours, minutes };
  if (hours) return { hours, minutes: 0 };
  return { hours: 0, minutes: Math.max(1, minutes) };
};

export const egressSummaryKey = (egress: SandboxProfileItem['egress']) =>
  `profile.egress.${egress.mode}` as const;
