import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('OpenAICodexSignIn layout', () => {
  it('keeps the subscription card shrinkable inside the provider detail pane', () => {
    const src = readFileSync(join(dir, 'OpenAICodexSignIn.tsx'), 'utf8');

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

  it('moves the long subscription notes onto a keyboard-reachable help icon', () => {
    const src = readFileSync(join(dir, 'OpenAICodexSignIn.tsx'), 'utf8');

    expect(src).toContain('CircleHelpIcon');
    expect(src).toContain("t('openaiCodex.helpAria')");
    expect(src).toContain("trigger={['hover', 'focus']}");
    expect(src).toContain("t('openaiCodex.hint')");
    expect(src).toContain("t('openaiCodex.deviceLoginPrerequisite')");
    expect(src).toContain("t('openaiCodex.unofficial')");
    expect(src).not.toContain('<div className={styles.hint}>{t(\'openaiCodex.hint\')}</div>');
    expect(src).not.toContain(
      '<div className={styles.hint}>{t(\'openaiCodex.deviceLoginPrerequisite\')}</div>',
    );
  });

  it('renders connected usage as labeled meters instead of stacked hint lines', () => {
    const src = readFileSync(join(dir, 'OpenAICodexSignIn.tsx'), 'utf8');

    expect(src).toContain('<Progress');
    expect(src).toContain('<Tag');
    expect(src).toContain('formatCodexPlanLabel');
    expect(src).toContain('fiveHourTitle');
    expect(src).toContain('weeklyTitle');
    expect(src).toContain('remainingPercent');
  });
});
