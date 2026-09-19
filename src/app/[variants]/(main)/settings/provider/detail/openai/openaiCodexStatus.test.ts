import { describe, expect, it } from 'vitest';

import {
  clampCodexUsagePercent,
  formatCodexPlanLabel,
  resolveCodexUsageStroke,
} from './openaiCodexStatus';

describe('openaiCodexStatus', () => {
  it('title-cases ChatGPT plan labels', () => {
    expect(formatCodexPlanLabel('plus')).toBe('Plus');
    expect(formatCodexPlanLabel(' PRO ')).toBe('Pro');
    expect(formatCodexPlanLabel('')).toBeUndefined();
    expect(formatCodexPlanLabel(undefined)).toBeUndefined();
  });

  it('clamps remaining percent to a 0–100 integer', () => {
    expect(clampCodexUsagePercent(67.4)).toBe(67);
    expect(clampCodexUsagePercent(-4)).toBe(0);
    expect(clampCodexUsagePercent(140)).toBe(100);
    expect(clampCodexUsagePercent(Number.NaN)).toBe(0);
  });

  it('maps leftover quota onto Ant Design Progress status', () => {
    expect(resolveCodexUsageStroke(100)).toBe('success');
    expect(resolveCodexUsageStroke(40)).toBe('success');
    expect(resolveCodexUsageStroke(15)).toBe('normal');
    expect(resolveCodexUsageStroke(10)).toBe('exception');
  });
});
