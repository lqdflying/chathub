import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const usageDir = dirname(fileURLToPath(import.meta.url));

describe('assistant footer usage trigger', () => {
  it('anchors the popover to the right time and token chips, not the model name', () => {
    const usage = readFileSync(join(usageDir, 'index.tsx'), 'utf8');

    expect(usage.indexOf('<ModelIcon')).toBeGreaterThan(-1);
    expect(usage.indexOf('<TokenDetail')).toBeGreaterThan(usage.indexOf('<ModelIcon'));
    expect(usage).toContain('<span className={styles.trigger}>');
    expect(usage).toContain('{hasChips ? (');
    expect(usage).toContain('<span className={styles.trigger}>{chips}</span>');
  });

  it('opens the usage panel on click at topRight and never on hover', () => {
    const detail = readFileSync(join(usageDir, 'UsageDetail/index.tsx'), 'utf8');

    expect(detail).toContain("placement={'topRight'}");
    expect(detail).toContain("trigger={'click'}");
    expect(detail).not.toContain('hover');
    expect(detail).not.toMatch(/placement=\{'(top|topLeft)'\}/);
  });
});
