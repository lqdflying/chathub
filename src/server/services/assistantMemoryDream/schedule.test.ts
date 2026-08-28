import { describe, expect, it } from 'vitest';

import { resolveMemoryDreamSchedule, rollupBackoffDelayMs } from '@/helpers/assistantMemory';

import { isDreamDue, previousUtcDayWindow, resolveDreamPeriodStamp, utcDayStamp } from './schedule';

const at = (iso: string) => new Date(iso);

describe('resolveMemoryDreamSchedule', () => {
  it('defaults to off', () => {
    expect(resolveMemoryDreamSchedule({}).frequency).toBe('off');
    expect(resolveMemoryDreamSchedule(undefined).time).toBe('02:00');
  });

  it('honors an explicit frequency, including off over legacy toggles', () => {
    expect(
      resolveMemoryDreamSchedule({
        enableDailyMemorySummary: true,
        memoryDreamScheduleFrequency: 'off',
      }).frequency,
    ).toBe('off');
    expect(resolveMemoryDreamSchedule({ memoryDreamScheduleFrequency: 'weekly' }).frequency).toBe(
      'weekly',
    );
  });

  it('migrates either deprecated toggle to daily when frequency is unset', () => {
    expect(resolveMemoryDreamSchedule({ enableDailyMemorySummary: true }).frequency).toBe('daily');
    expect(
      resolveMemoryDreamSchedule({ enablePeriodicAssistantMemoryRollup: true }).frequency,
    ).toBe('daily');
  });
});

describe('isDreamDue', () => {
  const fridayAfter = at('2026-08-28T03:00:00.000Z');
  const fridayBefore = at('2026-08-28T01:00:00.000Z');

  it('skips when assistant memory is disabled', () => {
    expect(
      isDreamDue({
        chatConfig: { enableAssistantMemory: false, memoryDreamScheduleFrequency: 'daily' },
        now: fridayAfter,
      }),
    ).toMatchObject({ due: false, skippedReason: 'disabled' });
  });

  it('skips when frequency is off', () => {
    expect(isDreamDue({ chatConfig: {}, now: fridayAfter })).toMatchObject({
      due: false,
      skippedReason: 'off',
    });
  });

  it('skips daily runs before the UTC schedule time', () => {
    expect(
      isDreamDue({
        chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
        now: fridayBefore,
      }),
    ).toMatchObject({ due: false, skippedReason: 'before_time' });
  });

  it('is due for daily after the UTC schedule time', () => {
    const result = isDreamDue({
      chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
      now: fridayAfter,
    });
    expect(result).toMatchObject({ due: true, frequency: 'daily', periodStamp: '2026-08-28' });
    expect(result.skippedReason).toBeUndefined();
  });

  it('skips weekly runs on the wrong UTC weekday', () => {
    expect(
      isDreamDue({
        chatConfig: {
          memoryDreamScheduleFrequency: 'weekly',
          memoryDreamScheduleTime: '02:00',
          memoryDreamScheduleWeekday: 0,
        },
        now: fridayAfter,
      }),
    ).toMatchObject({ due: false, skippedReason: 'wrong_weekday' });
  });

  it('is due for weekly on the matching UTC weekday after the time', () => {
    expect(
      isDreamDue({
        chatConfig: {
          memoryDreamScheduleFrequency: 'weekly',
          memoryDreamScheduleTime: '02:00',
          memoryDreamScheduleWeekday: 5,
        },
        now: fridayAfter,
      }).due,
    ).toBe(true);
  });

  it('skips when the period marker is already written', () => {
    expect(
      isDreamDue({
        assistantMemoryMeta: { lastDreamMarker: '2026-08-28' },
        chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
        now: fridayAfter,
      }),
    ).toMatchObject({ due: false, skippedReason: 'already_ran' });
  });

  it('skips during failure backoff', () => {
    expect(
      isDreamDue({
        assistantMemoryMeta: {
          lastError: { at: fridayAfter.toISOString(), attempts: 1, message: 'boom' },
        },
        chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
        now: fridayAfter,
      }),
    ).toMatchObject({ due: false, skippedReason: 'backoff' });
  });

  it('is due again after backoff expires', () => {
    const attempts = 1;
    const failedAt = fridayAfter.getTime() - rollupBackoffDelayMs(attempts) - 1000;
    expect(
      isDreamDue({
        assistantMemoryMeta: {
          lastError: { at: new Date(failedAt).toISOString(), attempts, message: 'boom' },
        },
        chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
        now: fridayAfter,
      }).due,
    ).toBe(true);
  });
});

describe('previousUtcDayWindow / period stamps', () => {
  it('returns [yesterday 00:00 UTC, today 00:00 UTC)', () => {
    const { from, to } = previousUtcDayWindow(at('2026-08-28T03:15:00.000Z'));
    expect(from.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-28T00:00:00.000Z');
  });

  it('uses the UTC date for daily stamps even near midnight', () => {
    expect(utcDayStamp(at('2026-08-28T23:59:00.000Z'))).toBe('2026-08-28');
    expect(resolveDreamPeriodStamp('daily', at('2026-08-29T00:00:00.000Z'))).toBe('2026-08-29');
  });
});
