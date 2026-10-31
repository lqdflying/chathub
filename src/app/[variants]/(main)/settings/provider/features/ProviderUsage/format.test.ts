import { describe, expect, it } from 'vitest';

import {
  formatUsageCount,
  formatUsageMoney,
  formatUsageTime,
  resolveUsageStroke,
  usageWindowTitleKey,
} from './format';

describe('provider usage format helpers', () => {
  it('formats currency amounts with two decimals', () => {
    expect(formatUsageMoney(12.5, 'usd', 'en-US')).toBe('$12.50');
    expect(formatUsageMoney(3, 'CNY', 'en-US')).toBe('CN¥3.00');
  });

  it('falls back to a plain amount for an unknown currency code', () => {
    expect(formatUsageMoney(1.234, 'not-a-code', 'en-US')).toBe('1.23 NOT-A-CODE');
  });

  it('formats token counts compactly', () => {
    expect(formatUsageCount(1_500_000, 'en-US')).toBe('1.5M');
  });

  it('ignores invalid timestamps', () => {
    expect(formatUsageTime(undefined)).toBeUndefined();
    expect(formatUsageTime('not a date')).toBeUndefined();
  });

  it('maps window kinds to locale keys and remaining percent to stroke', () => {
    expect(usageWindowTitleKey('fiveHour')).toBe('providerUsage.window.fiveHour');
    expect(resolveUsageStroke(80)).toBe('success');
    expect(resolveUsageStroke(20)).toBe('normal');
    expect(resolveUsageStroke(5)).toBe('exception');
  });
});
