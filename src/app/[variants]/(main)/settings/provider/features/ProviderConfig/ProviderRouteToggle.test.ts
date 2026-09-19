import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('ProviderRouteToggle', () => {
  it('uses a two-column grid and is not an antd block control', () => {
    const src = readFileSync(join(dir, 'ProviderRouteToggle.tsx'), 'utf8');

    expect(src).toContain('display: grid');
    expect(src).toContain('repeat(2, minmax(0, 1fr))');
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).not.toContain('<Segmented');
    expect(src).not.toContain('<Radio');
  });
});
