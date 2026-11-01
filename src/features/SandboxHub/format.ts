import type { SandboxProfileItem } from '@lobechat/types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "30 min", "2 h", "1 h 30 min"; 0 means "no limit" or "per call" depending on the field. */
export const formatDuration = (ms: number) => {
  if (ms <= 0) return undefined;
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${Math.max(1, minutes)} min`;
};

export const egressSummaryKey = (egress: SandboxProfileItem['egress']) =>
  `profile.egress.${egress.mode}` as const;
