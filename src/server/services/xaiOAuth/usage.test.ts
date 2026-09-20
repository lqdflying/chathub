import { describe, expect, it } from 'vitest';

import { parseXaiUsageWindows, remainingPercentFromUsed } from './usage';

describe('parseXaiUsageWindows', () => {
  it('reads the weekly SuperGrok pool from billing config', () => {
    expect(
      parseXaiUsageWindows({
        config: {
          creditUsagePercent: 37,
          currentPeriod: {
            end: '2026-09-26T00:00:00Z',
            type: 'CREDIT_WEEKLY',
          },
        },
      }),
    ).toEqual({
      weekly: {
        label: 'Weekly',
        remainingPercent: remainingPercentFromUsed(37),
        resetsAt: '2026-09-26T00:00:00.000Z',
        usedPercent: 37,
      },
    });
  });

  it('labels a monthly period when that is what the payload says', () => {
    const parsed = parseXaiUsageWindows({
      config: {
        creditUsagePercent: 10,
        currentPeriod: { type: 'CREDIT_MONTHLY' },
      },
    });

    expect(parsed.weekly?.label).toBe('Monthly');
    expect(parsed.fiveHour).toBeUndefined();
  });

  it('hides the 5-hour meter when no second window is present', () => {
    const parsed = parseXaiUsageWindows({
      config: { creditUsagePercent: 5, currentPeriod: { type: 'CREDIT_WEEKLY' } },
    });

    expect(parsed.fiveHour).toBeUndefined();
    expect(parsed.weekly).toBeDefined();
  });

  it('shows a 5-hour meter only when a ~5-hour window is present', () => {
    const parsed = parseXaiUsageWindows({
      config: {
        creditUsagePercent: 20,
        currentPeriod: { type: 'CREDIT_WEEKLY' },
        windows: [{ duration: 5 * 60 * 60, usedPercent: 55 }],
      },
    });

    expect(parsed.weekly?.usedPercent).toBe(20);
    expect(parsed.fiveHour?.usedPercent).toBe(55);
    expect(parsed.fiveHour?.windowSeconds).toBe(18_000);
  });

  it('uses the on-demand ratio when creditUsagePercent is omitted', () => {
    const parsed = parseXaiUsageWindows({
      config: {
        currentPeriod: {
          end: '2026-09-26T00:00:00Z',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        onDemandCap: { val: 100 },
        onDemandUsed: { val: 25 },
      },
    });

    expect(parsed.weekly).toEqual({
      label: 'Weekly',
      remainingPercent: remainingPercentFromUsed(25),
      resetsAt: '2026-09-26T00:00:00.000Z',
      usedPercent: 25,
    });
  });

  it('keeps the weekly window without inventing 0% when only the period is present', () => {
    const parsed = parseXaiUsageWindows({
      config: {
        currentPeriod: {
          end: '2026-09-26T00:00:00Z',
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
        },
        isUnifiedBillingUser: true,
        monthlyLimit: { val: 0 },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
      },
    });

    expect(parsed.weekly).toEqual({
      label: 'Weekly',
      resetsAt: '2026-09-26T00:00:00.000Z',
    });
    expect(parsed.weekly?.remainingPercent).toBeUndefined();
    expect(parsed.fiveHour).toBeUndefined();
  });
});
