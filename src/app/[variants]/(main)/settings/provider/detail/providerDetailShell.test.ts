import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PROVIDER_LIST } from '@/config/modelProviders';

const detailDir = dirname(fileURLToPath(import.meta.url));

const SPECIAL_CASED_DETAIL_IDS = ['openai', 'azure', 'azureai', 'anthropiccompatible'] as const;

describe('provider settings detail shell', () => {
  it('keeps Connectivity Check on for every builtin provider', () => {
    expect(DEFAULT_MODEL_PROVIDER_LIST.map((provider) => provider.id)).toEqual([
      'openai',
      'azure',
      'azureai',
      'anthropic',
      'anthropiccompatible',
      'deepseek',
      'google',
      'mimo',
      'minimax',
      'moonshot',
      'openaicompatible',
      'zhipu',
    ]);

    for (const provider of DEFAULT_MODEL_PROVIDER_LIST) {
      expect(provider.settings?.showChecker ?? true, provider.id).toBe(true);
    }
  });

  it('routes special-cased and default providers through the shared ProviderConfig + ModelList', () => {
    const router = readFileSync(join(detailDir, 'index.tsx'), 'utf8');
    expect(router).toContain("import DefaultPage from './default/ProviderDetialPage'");
    expect(router).toContain('<DefaultPage id={id} />');

    for (const id of SPECIAL_CASED_DETAIL_IDS) {
      const src = readFileSync(join(detailDir, id, 'index.tsx'), 'utf8');
      expect(src, id).toContain("from '../default'");
      expect(src, id).toContain('<ProviderDetail');
    }

    const shared = readFileSync(join(detailDir, 'default/index.tsx'), 'utf8');
    expect(shared).toContain('<ProviderConfig');
    expect(shared).toContain('<ModelList');

    const custom = readFileSync(join(detailDir, 'default/ClientMode.tsx'), 'utf8');
    expect(custom).toContain('<ProviderConfig');
    expect(custom).toContain('<ModelList');
  });

  it('keeps the detail pane shrinkable so Check and Fetch cannot be clipped', () => {
    const root = process.cwd();
    const layout = readFileSync(
      join(root, 'src/app/[variants]/(main)/settings/provider/_layout/Desktop/index.tsx'),
      'utf8',
    );
    expect(layout).toContain('flex={1}');
    expect(layout).toContain('minWidth: 0');

    const container = readFileSync(
      join(root, 'src/app/[variants]/(main)/settings/provider/_layout/Desktop/Container.tsx'),
      'utf8',
    );
    expect(container).toContain('minWidth: 0');

    const settingContainer = readFileSync(
      join(root, 'src/features/Setting/SettingContainer.tsx'),
      'utf8',
    );
    expect(settingContainer).toContain('minWidth: 0');

    const form = readFileSync(
      join(root, 'src/app/[variants]/(main)/settings/provider/features/ProviderConfig/index.tsx'),
      'utf8',
    );
    expect(form).toContain("layout={'vertical'}");
    expect(form).toContain('itemMinWidth={undefined}');
    expect(form).not.toContain('{...FORM_STYLE}');
    expect(form).not.toContain('min-width: min(100%, 320px)');
    expect(form).toContain('flex-direction: column !important');
    expect(form).toContain('align-items: stretch !important');
    expect(form).toContain('width: 100% !important');
    expect(form).toContain('min-width: 0 !important');
    expect(form).toContain('.${prefixCls}-row > .${prefixCls}-form-item-label');
    expect(form).toContain('.${prefixCls}-form-item-row > .${prefixCls}-form-item-label');
    expect(form).toContain('.${prefixCls}-row > .${prefixCls}-form-item-control');
    expect(form).toContain('.${prefixCls}-form-item-row > .${prefixCls}-form-item-control');
    expect(form).toContain("style={{ maxWidth: '100%', minWidth: 0, width: '100%' }}>{extra}</Flexbox>");
  });
});
