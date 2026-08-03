import {
  LobeAnthropicAI,
  LobeAzureOpenAI,
  LobeGoogleAI,
  LobeMoonshotAI,
  LobeOpenAI,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { initializeWithClientStore } from './clientModelRuntime';

// Mocking external dependencies
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ some: 'data' })))),
);

vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();

  return { ...(module as any), getMessageError: vi.fn() };
});

const setRuntimeKeyVaults = (provider: string, keyVaults: Record<string, string>) => {
  const runtimeScope = authSelectors.currentUserScope(useUserStore.getState());
  if (!runtimeScope) throw new Error('Expected a test user scope');

  useAiInfraStore.setState({
    aiProviderRuntimeConfig: {
      [provider]: { config: {}, keyVaults, settings: {} },
    } as any,
    runtimeStateRequestScope: runtimeScope,
    runtimeStateScope: runtimeScope,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // 清除所有模块的缓存
  vi.resetModules();

  vi.clearAllMocks();
  useUserStore.setState({
    authUserId: 'test-user',
    isLoaded: true,
    isSignedIn: true,
    user: { id: 'test-user' },
    userStateInitializationFailure: undefined,
  });
  useAiInfraStore.setState({
    aiProviderRuntimeConfig: {},
    runtimeStateRequestScope: undefined,
    runtimeStateScope: undefined,
  });
});

describe('ModelRuntimeOnClient', () => {
  describe('initializeWithClientStore', () => {
    describe('should initialize with options correctly', () => {
      it('OpenAI provider: with apikey and endpoint', async () => {
        setRuntimeKeyVaults(ModelProvider.OpenAI, {
          apiKey: 'user-openai-key',
          baseURL: 'user-openai-endpoint',
        });
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
        expect(runtime['_runtime'].baseURL).toBe('user-openai-endpoint');
      });

      it('Azure provider: with apiKey, apiVersion, endpoint', async () => {
        setRuntimeKeyVaults(ModelProvider.Azure, {
          apiKey: 'user-azure-key',
          apiVersion: '2024-06-01',
          endpoint: 'user-azure-endpoint',
        });

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Azure,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAzureOpenAI);
      });

      it('Google provider: with apiKey', async () => {
        setRuntimeKeyVaults(ModelProvider.Google, { apiKey: 'user-google-key' });
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Google,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeGoogleAI);
      });

      it('Moonshot AI provider: with apiKey', async () => {
        setRuntimeKeyVaults(ModelProvider.Moonshot, { apiKey: 'user-moonshot-key' });
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Moonshot,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMoonshotAI);
      });

      it('Anthropic provider: with apiKey', async () => {
        setRuntimeKeyVaults(ModelProvider.Anthropic, { apiKey: 'user-anthropic-key' });
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Anthropic,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAnthropicAI);
      });

      /**
       * Should not have a unknown provider in client, but has
       * similar cases in server side
       */
      it('Unknown provider: with apiKey', async () => {
        setRuntimeKeyVaults('unknown', {
          apiKey: 'user-unknown-key',
          endpoint: 'user-unknown-endpoint',
        });
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: 'unknown' as ModelProvider,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
      });
    });
  });
});
