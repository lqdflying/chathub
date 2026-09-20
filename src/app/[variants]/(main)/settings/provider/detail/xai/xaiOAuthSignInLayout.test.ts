import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('XaiOAuthSignIn layout', () => {
  it('keeps the SuperGrok card shrinkable inside the provider detail pane', () => {
    const src = readFileSync(join(dir, 'XaiOAuthSignIn.tsx'), 'utf8');

    expect(src).toContain('width: 100%');
    expect(src).toContain('max-width: 100%');
    expect(src).toContain('min-width: 0');
    expect(src).toContain('overflow-wrap: anywhere');
    expect(src).toContain('flex-direction: column');
    expect(src).not.toContain('flex: 1 1 12rem');
    expect(src).toContain('statusRow');
    expect(src).toContain('fiveHourLeft');
    expect(src).toContain('weeklyLeft');
  });

  it('moves the unofficial SuperGrok notes onto a keyboard-reachable help icon', () => {
    const src = readFileSync(join(dir, 'XaiOAuthSignIn.tsx'), 'utf8');

    expect(src).toContain('CircleHelpIcon');
    expect(src).toContain("t('xaiOAuth.helpAria')");
    expect(src).toContain('resolveCodexHelpTrigger');
    expect(src).toContain('CODEX_HELP_TOOLTIP_MAX_WIDTH');
    expect(src).not.toContain("trigger={['hover', 'focus']}");
    expect(src).toContain("t('xaiOAuth.hint')");
    expect(src).toContain("t('xaiOAuth.deviceLoginPrerequisite')");
    expect(src).toContain("t('xaiOAuth.unofficial')");
    expect(src).not.toContain('<div className={styles.hint}>{t(\'xaiOAuth.hint\')}</div>');
  });

  it('lets quota labels and the plan badge wrap inside the card', () => {
    const src = readFileSync(join(dir, 'XaiOAuthSignIn.tsx'), 'utf8');

    expect(src).toContain('meterHeading');
    expect(src).toContain('flex-wrap: wrap');
    expect(src).toContain('planTag');
    expect(src).toContain('white-space: normal !important');
    expect(src).toContain('<Progress');
    expect(src).toContain('<Tag');
    expect(src).toContain('fiveHourTitle');
    expect(src).toContain('weeklyTitle');
    expect(src).toContain('remainingPercent');
    expect(src).toContain("t('xaiOAuth.usageUnavailable')");
  });

  it('schedules device polls with the vendor interval instead of a fixed interval', () => {
    const src = readFileSync(join(dir, 'XaiOAuthSignIn.tsx'), 'utf8');

    expect(src).toContain('setTimeout');
    expect(src).toContain('started.intervalMs');
    expect(src).toContain('nextDelayMs');
    expect(src).not.toContain('setInterval');
    expect(src).not.toContain('POLL_INTERVAL_MS');
    expect(src).toContain('loginGeneration');
    expect(src).toContain('invalidateDeviceLogin');
    expect(src).toContain('isCurrentAttempt');
  });
});
