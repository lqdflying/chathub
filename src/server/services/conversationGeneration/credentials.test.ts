/** @vitest-environment node */
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FETCH_ON_CLIENT_ERROR } from './constants';
import { resolveConversationRuntimePayload } from './credentials';

const runtimeState = vi.hoisted(() => ({
  getAiProviderRuntimeState: vi.fn(),
}));
const llmConfig = vi.hoisted(() => ({
  get: vi.fn(() => ({})),
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
  getLLMConfig: llmConfig.get,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
  },
}));

vi.mock('@/server/services/openaiCodex/resolve', () => ({
  resolveOpenAICodexChatPayload: vi.fn(async (_db: unknown, _provider: string, payload: unknown) => payload),
}));

import { UserModel } from '@/database/models/user';
import { resolveOpenAICodexChatPayload } from '@/server/services/openaiCodex/resolve';

describe('resolveConversationRuntimePayload', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    llmConfig.get.mockReturnValue({});
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

  it('does not let an OpenAI environment key satisfy a built-in non-OpenAI provider', async () => {
    llmConfig.get.mockReturnValue({ OPENAI_API_KEY: 'sk-openai-only' });
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        anthropic: { fetchOnClient: false, keyVaults: {} },
      },
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'anthropic',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'No server-reachable credentials were found for provider "anthropic".',
    } satisfies Partial<TRPCError>);
  });

  it('allows a custom OpenAI-runtime provider to use the OpenAI environment key', async () => {
    llmConfig.get.mockReturnValue({ OPENAI_API_KEY: 'sk-openai-runtime' });
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        gateway: {
          fetchOnClient: false,
          keyVaults: {},
          settings: { sdkType: 'openai' },
        },
      },
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'gateway',
        userId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        runtimeProvider: 'openai',
        userId: 'user-1',
      }),
    );
  });

  it('maps user AWS vault fields when the provider stores access keys instead of apiKey', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        bedrock: { fetchOnClient: false, keyVaults: {} },
      },
    });
    vi.mocked(UserModel.getUserApiKeys).mockResolvedValue({
      bedrock: {
        accessKeyId: 'AKIAEXAMPLE',
        region: 'us-east-1',
        secretAccessKey: 'secret-example',
      },
    } as any);

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'bedrock',
        userId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accessKeyId: 'AKIAEXAMPLE',
        awsAccessKeyId: 'AKIAEXAMPLE',
        awsRegion: 'us-east-1',
        awsSecretAccessKey: 'secret-example',
        userId: 'user-1',
      }),
    );
  });

  it('keeps structured generation on the Platform key while a Codex session is connected', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        openai: { fetchOnClient: false, keyVaults: { apiKey: 'sk-test' } },
      },
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'openai',
        purpose: 'structured',
        userId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: 'sk-test',
        userId: 'user-1',
      }),
    );
    expect(resolveOpenAICodexChatPayload).toHaveBeenCalledWith(
      {},
      'openai',
      expect.objectContaining({ apiKey: 'sk-test', userId: 'user-1' }),
      { purpose: 'structured' },
    );
  });

  it('does not select the Platform key when Codex refresh is temporarily unavailable', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        openai: { fetchOnClient: false, keyVaults: { apiKey: 'sk-test' } },
      },
    });
    const { OpenAICodexTransientRefreshError } = await import(
      '@/server/services/openaiCodex/errors'
    );
    vi.mocked(resolveOpenAICodexChatPayload).mockRejectedValueOnce(
      new OpenAICodexTransientRefreshError('ChatGPT subscription refresh is temporarily unavailable.', 503),
    );

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'openai',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'ChatGPT subscription refresh is temporarily unavailable.',
    } satisfies Partial<TRPCError>);
  });

  it('treats a live Codex session as a credential without an API key or env key', async () => {
    runtimeState.getAiProviderRuntimeState.mockResolvedValue({
      runtimeConfig: {
        openai: { fetchOnClient: false, keyVaults: {} },
      },
    });
    vi.mocked(resolveOpenAICodexChatPayload).mockResolvedValueOnce({
      accountId: 'acct_1',
      apiKey: 'codex-access',
      authMode: 'codex-oauth',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      runtimeProvider: 'openai',
      userId: 'user-1',
    });

    await expect(
      resolveConversationRuntimePayload({
        db: {} as any,
        provider: 'openai',
        userId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: 'acct_1',
        apiKey: 'codex-access',
        authMode: 'codex-oauth',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        userId: 'user-1',
      }),
    );
  });
});
