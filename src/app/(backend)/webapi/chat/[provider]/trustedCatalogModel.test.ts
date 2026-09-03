// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModelModel } from '@/database/models/aiModel';
import { getServerDB } from '@/database/server';
import { getServerGlobalConfig } from '@/server/globalConfig';

import { resolveTrustedCatalogModel, validateAzureCatalogModel } from './trustedCatalogModel';

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn(),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn(),
}));

describe('validateAzureCatalogModel', () => {
  it('accepts an exact server catalog and deployment mapping', () => {
    expect(
      validateAzureCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-gpt',
        serverModels: [
          {
            config: { deploymentName: 'production-gpt' },
            id: 'gpt-5.6-sol',
          },
        ],
        userModels: [],
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('uses the user deployment override before the server default', () => {
    expect(
      validateAzureCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'user-production-gpt',
        serverModels: [
          {
            config: { deploymentName: 'server-production-gpt' },
            id: 'gpt-5.6-sol',
          },
        ],
        userModels: [
          {
            config: { deploymentName: 'user-production-gpt' },
            id: 'gpt-5.6-sol',
          },
        ],
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('rejects a deployment that does not match the effective mapping', () => {
    expect(
      validateAzureCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'attacker-selected-deployment',
        serverModels: [
          {
            config: { deploymentName: 'server-production-gpt' },
            id: 'gpt-5.6-sol',
          },
        ],
        userModels: [],
      }),
    ).toBeUndefined();
  });
});

describe('resolveTrustedCatalogModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(getServerGlobalConfig).mockResolvedValue({
      aiProvider: {
        azure: {
          serverModelLists: [
            {
              config: { deploymentName: 'server-production-gpt' },
              id: 'gpt-5.6-sol',
            },
          ],
        },
      },
    } as never);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          getModelListByProviderId: vi.fn().mockResolvedValue([
            {
              config: { deploymentName: 'user-production-gpt' },
              id: 'gpt-5.6-sol',
            },
          ]),
        }) as never,
    );
  });

  it('returns the catalog model for the authenticated user deployment mapping', async () => {
    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'user-production-gpt',
        runtimeProvider: 'azure',
        userId: 'test-user',
      }),
    ).resolves.toBe('gpt-5.6-sol');

    expect(AiModelModel).toHaveBeenCalledWith(expect.anything(), 'test-user');
  });

  it('returns undefined when the user model database read fails', async () => {
    vi.mocked(getServerDB).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'server-production-gpt',
        runtimeProvider: 'azure',
        userId: 'test-user',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when server model configuration cannot be loaded', async () => {
    vi.mocked(getServerGlobalConfig).mockRejectedValueOnce(new Error('configuration unavailable'));

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'server-production-gpt',
        runtimeProvider: 'azure',
        userId: 'test-user',
      }),
    ).resolves.toBeUndefined();
  });

  it.each(['gpt-4o', 'o3', 'gpt-5.5'])(
    'skips all model configuration reads for cache-ineligible %s',
    async (catalogModel) => {
      await expect(
        resolveTrustedCatalogModel({
          catalogModel,
          deploymentName: catalogModel,
          runtimeProvider: 'azure',
          userId: 'test-user',
        }),
      ).resolves.toBeUndefined();

      expect(getServerDB).not.toHaveBeenCalled();
      expect(getServerGlobalConfig).not.toHaveBeenCalled();
      expect(AiModelModel).not.toHaveBeenCalled();
    },
  );

  it('uses configured Azure mappings for eligible models', async () => {
    vi.mocked(getServerGlobalConfig).mockResolvedValue({
      aiProvider: {
        azure: {
          serverModelLists: [
            {
              config: { deploymentName: 'gpt-5.6-production' },
              id: 'gpt-5.6-sol',
            },
          ],
        },
      },
    } as never);

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'gpt-5.6-production',
        runtimeProvider: 'azure',
        userId: undefined,
      }),
    ).resolves.toBe('gpt-5.6-sol');
  });

  it('does not load model configuration for non-Azure runtimes', async () => {
    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'user-production-gpt',
        runtimeProvider: 'openai',
        userId: 'test-user',
      }),
    ).resolves.toBeUndefined();

    expect(getServerDB).not.toHaveBeenCalled();
    expect(getServerGlobalConfig).not.toHaveBeenCalled();
  });

  it('returns the catalog model for an authenticated Azure AI deployment mapping', async () => {
    const getModelListByProviderId = vi.fn().mockResolvedValue([
      {
        config: { deploymentName: 'production-sol' },
        id: 'gpt-5.6-sol',
      },
    ]);
    vi.mocked(getServerGlobalConfig).mockResolvedValue({
      aiProvider: {
        azureai: {
          serverModelLists: [],
        },
      },
    } as never);
    vi.mocked(AiModelModel).mockImplementation(() => ({ getModelListByProviderId }) as never);

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-sol',
        runtimeProvider: 'azureai',
        userId: 'test-user',
      }),
    ).resolves.toBe('gpt-5.6-sol');

    expect(getModelListByProviderId).toHaveBeenCalledWith('azureai');
  });

  it('does not use Azure OpenAI mappings for Azure AI', async () => {
    vi.mocked(getServerGlobalConfig).mockResolvedValue({
      aiProvider: {
        azure: {
          serverModelLists: [
            {
              config: { deploymentName: 'production-sol' },
              id: 'gpt-5.6-sol',
            },
          ],
        },
      },
    } as never);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          getModelListByProviderId: vi.fn().mockResolvedValue([]),
        }) as never,
    );

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'production-sol',
        runtimeProvider: 'azureai',
        userId: 'test-user',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an Azure AI deployment that does not match the effective mapping', async () => {
    vi.mocked(getServerGlobalConfig).mockResolvedValue({
      aiProvider: {
        azureai: {
          serverModelLists: [
            {
              config: { deploymentName: 'production-sol' },
              id: 'gpt-5.6-sol',
            },
          ],
        },
      },
    } as never);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          getModelListByProviderId: vi.fn().mockResolvedValue([]),
        }) as never,
    );

    await expect(
      resolveTrustedCatalogModel({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'attacker-selected-deployment',
        runtimeProvider: 'azureai',
        userId: 'test-user',
      }),
    ).resolves.toBeUndefined();
  });
});
