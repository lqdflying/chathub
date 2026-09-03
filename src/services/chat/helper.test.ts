import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';

import { resolveClientTrustedCatalogModel } from './helper';

const productionSol = {
  abilities: {},
  config: { deploymentName: 'production-sol' },
  id: 'gpt-5.6-sol',
  providerId: 'azure',
  type: 'chat' as const,
};

describe('resolveClientTrustedCatalogModel', () => {
  beforeEach(() => {
    useAiInfraStore.setState({ enabledAiModels: [productionSol] });
  });

  afterEach(() => {
    useAiInfraStore.setState({ enabledAiModels: undefined });
  });

  it('returns the catalog id when the local Azure deployment mapping matches', () => {
    expect(
      resolveClientTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-sol',
        provider: 'azure',
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('returns the catalog id when the local Azure AI deployment mapping matches', () => {
    useAiInfraStore.setState({
      enabledAiModels: [{ ...productionSol, providerId: 'azureai' }],
    });

    expect(
      resolveClientTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-sol',
        provider: 'azureai',
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('rejects a catalog claim that does not match the outgoing deployment', () => {
    expect(
      resolveClientTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'attacker-selected-deployment',
        provider: 'azure',
      }),
    ).toBeUndefined();
  });

  it('does not resolve catalog identity for non-Azure providers', () => {
    expect(
      resolveClientTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-sol',
        provider: 'openai',
      }),
    ).toBeUndefined();
  });
});
