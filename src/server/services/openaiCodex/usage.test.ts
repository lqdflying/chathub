import { describe, expect, it } from 'vitest';

import {
  classifyOpenAICodexUsageWindow,
  parseOpenAICodexUsageWindows,
  remainingPercentFromUsed,
  windowMinutesFromSeconds,
} from './usage';

describe('parseOpenAICodexUsageWindows', () => {
  const plusPayload = {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        limit_window_seconds: 18_000,
        reset_after_seconds: 2547,
        reset_at: 1_778_670_307,
        used_percent: 27,
      },
      secondary_window: {
        limit_window_seconds: 604_800,
        reset_after_seconds: 566_340,
        reset_at: 1_783_357_722,
        used_percent: 31,
      },
    },
  };

  it('maps official Plus 5-hour and weekly windows to remaining percent', () => {
    const usage = parseOpenAICodexUsageWindows(plusPayload);

    expect(usage.fiveHour).toMatchObject({
      remainingPercent: 73,
      usedPercent: 27,
      windowMinutes: 300,
      windowSeconds: 18_000,
    });
    expect(usage.weekly).toMatchObject({
      remainingPercent: 69,
      usedPercent: 31,
      windowMinutes: 10_080,
      windowSeconds: 604_800,
    });
    expect(usage.fiveHour?.resetsAt).toBe(new Date(1_778_670_307 * 1000).toISOString());
    expect(usage.weekly?.resetsAt).toBe(new Date(1_783_357_722 * 1000).toISOString());
  });

  it('classifies a weekly-only primary slot when the 5-hour meter is absent', () => {
    const usage = parseOpenAICodexUsageWindows({
      rate_limit: {
        primary_window: {
          limit_window_seconds: 604_800,
          reset_at: 1_783_357_722,
          used_percent: 31,
        },
        secondary_window: null,
      },
    });

    expect(usage.fiveHour).toBeUndefined();
    expect(usage.weekly?.remainingPercent).toBe(69);
  });

  it('classifies by duration when the backend swaps primary and secondary', () => {
    const usage = parseOpenAICodexUsageWindows({
      rate_limit: {
        primary_window: plusPayload.rate_limit.secondary_window,
        secondary_window: plusPayload.rate_limit.primary_window,
      },
    });

    expect(usage.fiveHour?.windowSeconds).toBe(18_000);
    expect(usage.weekly?.windowSeconds).toBe(604_800);
  });

  it('ignores unknown window lengths instead of labeling them 5-hour or weekly', () => {
    const usage = parseOpenAICodexUsageWindows({
      rate_limit: {
        primary_window: {
          limit_window_seconds: 43_800 * 60,
          reset_at: 1_783_357_722,
          used_percent: 10,
        },
      },
    });

    expect(usage).toEqual({});
  });

  it('clamps remaining percent and matches Codex minute rounding', () => {
    expect(remainingPercentFromUsed(-4)).toBe(100);
    expect(remainingPercentFromUsed(100)).toBe(0);
    expect(remainingPercentFromUsed(131)).toBe(0);
    expect(windowMinutesFromSeconds(18_000)).toBe(300);
    expect(windowMinutesFromSeconds(604_800)).toBe(10_080);
    expect(
      classifyOpenAICodexUsageWindow({
        remainingPercent: 50,
        usedPercent: 50,
        windowMinutes: 305,
        windowSeconds: 18_300,
      }),
    ).toBe('fiveHour');
  });
});
