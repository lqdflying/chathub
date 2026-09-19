import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DESKTOP_SETTINGS_LAYOUT_STYLE } from './desktopSettingsLayoutStyle';

const dir = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();

describe('DesktopSettingsLayout shrink chain', () => {
  it('lets the Settings flex item shrink below min-content', () => {
    expect(DESKTOP_SETTINGS_LAYOUT_STYLE.flex).toBe('1');
    expect(DESKTOP_SETTINGS_LAYOUT_STYLE.minWidth).toBe(0);
    expect(DESKTOP_SETTINGS_LAYOUT_STYLE.position).toBe('relative');

    const src = readFileSync(join(dir, 'index.tsx'), 'utf8');
    expect(src).toContain('...DESKTOP_SETTINGS_LAYOUT_STYLE');
    expect(src).toContain('data-testid="desktop-settings-layout"');
    expect(src).toContain('flex={1}');
    expect(src).toContain('style={{ minWidth: 0 }}');
    expect(src).not.toMatch(/style=\{\{\s*background:[^}]*flex:\s*'1'[^}]*\}\}/);
  });

  it('keeps every desktop Settings / provider width ancestor shrinkable', () => {
    const chain = [
      join(root, 'src/app/[variants]/(main)/settings/_layout/Desktop/index.tsx'),
      join(root, 'src/features/Setting/SettingContainer.tsx'),
      join(root, 'src/app/[variants]/(main)/settings/provider/_layout/Desktop/index.tsx'),
      join(root, 'src/app/[variants]/(main)/settings/provider/_layout/Desktop/Container.tsx'),
    ];

    for (const file of chain) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toMatch(/minWidth:\s*0|min-width:\s*0/);
    }
  });
});
