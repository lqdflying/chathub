import { describe, expect, it } from 'vitest';

import {
  formatGenerationDuration,
  getFooterTimeChipLabel,
  resolveFooterTotalTimeMs,
} from './formatGenerationDuration';

describe('formatGenerationDuration', () => {
  it('formats sub-minute totals as whole seconds', () => {
    expect(formatGenerationDuration(40_100)).toBe('40s');
    expect(formatGenerationDuration(0)).toBe('0s');
  });

  it('formats minute-plus totals as m s', () => {
    expect(formatGenerationDuration(72_000)).toBe('1m 12s');
    expect(formatGenerationDuration(60_000)).toBe('1m');
  });

  it('omits invalid values', () => {
    expect(formatGenerationDuration(undefined)).toBeUndefined();
    expect(formatGenerationDuration(-1)).toBeUndefined();
    expect(formatGenerationDuration(Number.NaN)).toBeUndefined();
  });
});

describe('getFooterTimeChipLabel', () => {
  it('prefers latency, then duration', () => {
    expect(getFooterTimeChipLabel({ latency: 40_100, duration: 1000 })).toBe('40s');
    expect(getFooterTimeChipLabel({ duration: 72_000 })).toBe('1m 12s');
  });

  it('omits the chip when no latency or duration is present', () => {
    expect(resolveFooterTotalTimeMs({})).toBeUndefined();
    expect(getFooterTimeChipLabel({})).toBeUndefined();
    expect(getFooterTimeChipLabel({ tps: 12, ttft: 800 } as { tps: number; ttft: number })).toBe(
      undefined,
    );
  });
});
