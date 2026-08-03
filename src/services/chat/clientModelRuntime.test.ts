import {
  LobeAnthropicAI,
  LobeAzureOpenAI,
  LobeGoogleAI,
  LobeMoonshotAI,
  LobeOpenAI,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { merge } from 'lodash-es';
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserStore } from '@/store/user';
import { UserSettingsState, initialSettingsState } from '@/store/user/slices/settings/initialState';

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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // 清除所有模块的缓存
  vi.resetModules();

  vi.clearAllMocks();
});

describe('ModelRuntimeOnClient', () => {
  describe('initializeWithClientStore', () => {
    describe('should initialize with options correctly', () => {
      it('OpenAI provider: with apikey and endpoint', async () => {
        // Mock the global store to return the user's OpenAI API key and endpoint
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              openai: {
                apiKey: 'user-openai-key',
                baseURL: 'user-openai-endpoint',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.OpenAI,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeOpenAI);
        expect(runtime['_runtime'].baseURL).toBe('user-openai-endpoint');
      });

      it('Azure provider: with apiKey, apiVersion, endpoint', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              azure: {
                apiKey: 'user-azure-key',
                endpoint: 'user-azure-endpoint',
                apiVersion: '2024-06-01',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;

        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Azure,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeAzureOpenAI);
      });

      it('Google provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              google: {
                apiKey: 'user-google-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Google,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeGoogleAI);
      });

      it('Moonshot AI provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              moonshot: {
                apiKey: 'user-moonshot-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
        const runtime = await initializeWithClientStore({
          payload: {},
          provider: ModelProvider.Moonshot,
        });
        expect(runtime).toBeInstanceOf(ModelRuntime);
        expect(runtime['_runtime']).toBeInstanceOf(LobeMoonshotAI);
      });

      it('Anthropic provider: with apiKey', async () => {
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              anthropic: {
                apiKey: 'user-anthropic-key',
              },
            },
          },
        } as UserSettingsState) as unknown as UserStore;
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
        merge(initialSettingsState, {
          settings: {
            keyVaults: {
              unknown: {
                apiKey: 'user-unknown-key',
                endpoint: 'user-unknown-endpoint',
              },
            },
          },
        } as any as UserSettingsState) as unknown as UserStore;
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
