import { describe, expect, it } from 'vitest';

import {
  CODEX_HELP_TOOLTIP_MAX_WIDTH,
  clampCodexUsagePercent,
  formatCodexPlanLabel,
  resolveCodexHelpTrigger,
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

  it('uses click-only help on coarse pointers so a first tap cannot open then close', () => {
    expect(resolveCodexHelpTrigger(true)).toEqual(['click']);
    expect(resolveCodexHelpTrigger(false)).toEqual(['hover', 'focus']);
    expect(resolveCodexHelpTrigger(true)).not.toContain('hover');
    expect(resolveCodexHelpTrigger(true)).not.toContain('focus');
  });

  it('caps the help popup to the lesser of 360px and the viewport minus a gutter', () => {
    expect(CODEX_HELP_TOOLTIP_MAX_WIDTH).toBe('min(360px, calc(100vw - 32px))');
  });
});
