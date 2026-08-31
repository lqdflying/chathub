import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentSelectors from '@/store/agent/selectors';
import * as aiInfraSelectors from '@/store/aiInfra/selectors';

import { getSearchConfig } from './getSearchConfig';

// Mock the store dependencies
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: vi.fn(),
  },
}));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiProviderSelectors: {
    isProviderHasBuiltinSearch: vi.fn(),
    providerKeyVaults: vi.fn(() => () => undefined),
  },
  aiModelSelectors: {
    isModelHasBuiltinSearch: vi.fn(),
    isModelBuiltinSearchInternal: vi.fn(),
    modelBuiltinSearchImpl: vi.fn(),
  },
}));

describe('getSearchConfig', () => {
  const model = 'gpt-4';
  const provider = 'openai';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => undefined as any,
    );
    vi.mocked(aiInfraSelectors.aiProviderSelectors.providerKeyVaults).mockReturnValue(
      () => undefined,
    );
  });

  it('should return correct config when search is enabled and no builtin search', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: false,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: false,
      useModelSearch: false,
      useApplicationBuiltinSearchTool: true,
    });
  });

  it('should return correct config when search is disabled', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'off',
      useModelBuiltinSearch: false,
    } as any);

    const result = getSearchConfig(model, provider);

    expect(result.enabledSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
    expect(result.useModelSearch).toBe(false);
  });

  it('should prefer model search when available and enabled', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: true,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: true,
      isModelHasBuiltinSearch: false,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });

  it('should use model search when model has builtin search and it is enabled', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: true,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'params' as any,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });

  it('should not use model search when model has builtin search but preference is disabled', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: false,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'params' as any,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => false,
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: false,
      useApplicationBuiltinSearchTool: true,
    });
  });

  it('should force use model search when searchImpl is internal', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: false,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'internal' as any,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => true
    );

    const result = getSearchConfig(model, provider);

    expect(result).toEqual({
      enabledSearch: true,
      isProviderHasBuiltinSearch: false,
      isModelHasBuiltinSearch: true,
      useModelSearch: true,
      useApplicationBuiltinSearchTool: false,
    });
  });

  it('should never use model built-in search for Moonshot (Kimi) provider', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: true,
    } as any);

    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
      () => true,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
      () => true,
    );

    const result = getSearchConfig('kimi-k2.6', 'moonshot');

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(true);
  });

  it.each(['openaicompatible', 'anthropiccompatible'])(
    'should use model built-in search for %s provider when toggle is on',
    (provider) => {
      vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
        searchMode: 'on',
        useModelBuiltinSearch: true,
      } as any);

      vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
        () => true,
      );
      vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
        () => true,
      );
      vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
        () => false,
      );

      const result = getSearchConfig('compatible-model', provider);

      expect(result.useModelSearch).toBe(true);
      expect(result.useApplicationBuiltinSearchTool).toBe(false);
    },
  );

  it.each(['openaicompatible', 'anthropiccompatible'])(
    'should use application search for %s provider when toggle is off',
    (provider) => {
      vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
        searchMode: 'on',
        useModelBuiltinSearch: false,
      } as any);

      vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
        () => true,
      );
      vi.mocked(aiInfraSelectors.aiModelSelectors.isModelHasBuiltinSearch).mockReturnValue(
        () => true,
      );
      vi.mocked(aiInfraSelectors.aiModelSelectors.isModelBuiltinSearchInternal).mockReturnValue(
        () => false,
      );

      const result = getSearchConfig('compatible-model', provider);

      expect(result.useModelSearch).toBe(false);
      expect(result.useApplicationBuiltinSearchTool).toBe(true);
    },
  );

  it('keeps ChatHub search for MiMo Token Plan even when native search is toggled on', () => {
    vi.mocked(agentSelectors.agentChatConfigSelectors.currentChatConfig).mockReturnValue({
      searchMode: 'on',
      useModelBuiltinSearch: true,
    } as any);
    vi.mocked(aiInfraSelectors.aiProviderSelectors.isProviderHasBuiltinSearch).mockReturnValue(
      () => false,
    );
    vi.mocked(aiInfraSelectors.aiModelSelectors.modelBuiltinSearchImpl).mockReturnValue(
      () => 'params' as any,
    );
    vi.mocked(aiInfraSelectors.aiProviderSelectors.providerKeyVaults).mockReturnValue(
      () => ({ baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' }) as any,
    );

    const result = getSearchConfig('mimo-v2.5-pro', 'mimo');

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(true);
  });
});
