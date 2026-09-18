import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

const composers = [
  join(dir, 'Desktop/ClassicChat.tsx'),
  join(dir, 'Desktop/GroupChat.tsx'),
  join(dir, 'Mobile/index.tsx'),
];

describe('composer store writes', () => {
  it.each(composers)('calls updateInputMessage instead of raw setState (%s)', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('updateInputMessage');
    expect(source).not.toMatch(/setState\(\s*\{\s*inputMessage/);
  });
});
