/** @vitest-environment node */
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FETCH_ON_CLIENT_ERROR } from './constants';
import { resolveConversationRuntimePayload } from './credentials';

const runtimeState = vi.hoisted(() => ({
  getAiProviderRuntimeState: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn(async () => ({ aiProvider: {} })),
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: class {
    getAiProviderRuntimeState = runtimeState.getAiProviderRuntimeState;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    getUserApiKeys: vi.fn(),
  },
}));

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({})),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
  },
}));

import { UserModel } from '@/database/models/user';

describe('resolveConversationRuntimePayload', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.mocked(UserModel.getUserApiKeys).mockResolvedValue({});
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it('fails enqueue when the provider is fetch-on-client without server credentials', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        openai: { fetchOnClient: true, keyVaults: {} },
      },
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        fetchOnClient: true,
        provider: 'openai',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: FETCH_ON_CLIENT_ERROR,
    } satisfies Partial<TRPCError>);
  });

  it('returns a runtime payload when a server API key is available', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        openai: { fetchOnClient: false, keyVaults: { apiKey: 'sk-test' } },
      },
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'openai',
        userId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: 'sk-test',
        runtimeProvider: 'openai',
        userId: 'user-1',
      }),
    );
  });
});
