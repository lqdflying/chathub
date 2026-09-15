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
});
