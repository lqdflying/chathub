// @vitest-environment node
import { EnabledAiModel, xai as xaiChatModels } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { AiProviderListItem } from '@/types/aiProvider';

import { AiInfraRepos } from './index';

describe('xAI native search after model customization', () => {
  it('keeps searchImpl on a pristine builtin card and after a user enabled row', async () => {
    const repo = new AiInfraRepos({} as any, 'user-1', { xai: { enabled: true } });
    vi.spyOn(repo, 'getAiProviderList').mockResolvedValue([
      { enabled: true, id: 'xai', name: 'xAI', source: 'builtin' },
    ] as AiProviderListItem[]);
    vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(xaiChatModels);
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([]);

    const pristine = await repo.getEnabledModels();
    const grok = pristine.find((model) => model.id === 'grok-4.6');
    expect(grok?.abilities.search).toBe(true);
    expect(grok?.settings?.searchImpl).toBe('params');

    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      {
        abilities: {},
        enabled: true,
        id: 'grok-4.6',
        providerId: 'xai',
        type: 'chat',
      },
    ] as EnabledAiModel[]);

    const customized = await repo.getEnabledModels();
    const customizedGrok = customized.find(
      (model) => model.id === 'grok-4.6' && model.providerId === 'xai',
    );
    expect(customizedGrok?.abilities.search).toBe(true);
    expect(customizedGrok?.settings?.searchImpl).toBe('params');
  });

  it('preserves an explicitly disabled Search capability from the model settings form', async () => {
    const repo = new AiInfraRepos({} as any, 'user-1', { xai: { enabled: true } });
    vi.spyOn(repo, 'getAiProviderList').mockResolvedValue([
      { enabled: true, id: 'xai', name: 'xAI', source: 'builtin' },
    ] as AiProviderListItem[]);
    vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(xaiChatModels);
    vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
      {
        abilities: { search: false },
        enabled: true,
        id: 'grok-4.6',
        providerId: 'xai',
        type: 'chat',
      },
    ] as EnabledAiModel[]);

    const customized = (await repo.getEnabledModels()).find(
      (model) => model.id === 'grok-4.6' && model.providerId === 'xai',
    );
    expect(customized?.abilities.search).toBe(false);
    expect(customized?.settings?.searchImpl).toBeUndefined();
  });
});
