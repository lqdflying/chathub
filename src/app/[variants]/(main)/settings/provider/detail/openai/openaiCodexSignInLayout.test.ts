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
    expect(src).toContain('statusText');
  });
});
