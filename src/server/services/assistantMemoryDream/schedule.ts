import type { AssistantMemoryMeta, LobeAgentChatConfig } from '@lobechat/types';

import {
  type MemoryDreamScheduleFrequency,
  resolveMemoryDreamSchedule,
  rollupBackoffDelayMs,
} from '@/helpers/assistantMemory';

export type DreamSkipReason =
  | 'already_ran'
  | 'backoff'
  | 'before_time'
  | 'disabled'
  | 'off'
  | 'wrong_weekday';

export interface DreamDueResult {
  due: boolean;
  frequency: MemoryDreamScheduleFrequency;
  periodStamp: string;
  scheduleTime: string;
  skippedReason?: DreamSkipReason;
}

const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseScheduleTime = (value: string | undefined): { hour: number; minute: number } => {
  const match = SCHEDULE_TIME_PATTERN.exec(value ?? '');
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 2, minute: 0 };
};

/** UTC calendar day `YYYY-MM-DD`. */
export const utcDayStamp = (now: Date) => now.toISOString().slice(0, 10);

/** ISO week stamp in UTC, e.g. `2026-W35`. */
export const utcWeekStamp = (now: Date) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.valueOf() - yearStart.valueOf()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

export const resolveDreamPeriodStamp = (frequency: MemoryDreamScheduleFrequency, now: Date) =>
  frequency === 'weekly' ? utcWeekStamp(now) : utcDayStamp(now);

/** `[start, end)` of the previous UTC calendar day. */
export const previousUtcDayWindow = (now: Date) => {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(startOfToday - 86_400_000),
    to: new Date(startOfToday),
  };
};

export const isDreamDue = ({
  assistantMemoryMeta,
  chatConfig,
  now = new Date(),
}: {
  assistantMemoryMeta?: AssistantMemoryMeta | null;
  chatConfig?: Partial<LobeAgentChatConfig> | null;
  now?: Date;
}): DreamDueResult => {
  const schedule = resolveMemoryDreamSchedule(chatConfig);
  const periodStamp = resolveDreamPeriodStamp(schedule.frequency, now);
  const base = {
    frequency: schedule.frequency,
    periodStamp,
    scheduleTime: schedule.time,
  };

  if (chatConfig?.enableAssistantMemory === false) {
    return { ...base, due: false, skippedReason: 'disabled' };
  }

  if (schedule.frequency === 'off') {
    return { ...base, due: false, skippedReason: 'off' };
  }

  if (schedule.frequency === 'weekly' && now.getUTCDay() !== schedule.weekday) {
    return { ...base, due: false, skippedReason: 'wrong_weekday' };
  }

  const { hour, minute } = parseScheduleTime(schedule.time);
  if (now.getUTCHours() < hour || (now.getUTCHours() === hour && now.getUTCMinutes() < minute)) {
    return { ...base, due: false, skippedReason: 'before_time' };
  }

  if (assistantMemoryMeta?.lastDreamMarker === periodStamp) {
    return { ...base, due: false, skippedReason: 'already_ran' };
  }

  if (assistantMemoryMeta?.lastError) {
    const lastAt = Date.parse(assistantMemoryMeta.lastError.at);
    if (
      Number.isFinite(lastAt) &&
      now.getTime() - lastAt < rollupBackoffDelayMs(assistantMemoryMeta.lastError.attempts)
    ) {
      return { ...base, due: false, skippedReason: 'backoff' };
    }
  }

  return { ...base, due: true };
};
