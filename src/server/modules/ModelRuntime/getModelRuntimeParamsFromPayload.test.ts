import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/llm', () => ({
  getLLMConfig: () => ({
    ANTHROPICCOMPATIBLE_API_KEY: 'sk-server-anthropic-compat',
    API_KEY_SELECT_MODE: 'random',
    AZUREAI_ENDPOINT: 'https://azureai.example',
    AZUREAI_ENDPOINT_KEY: 'sk-server-azureai',
    AZURE_API_KEY: 'sk-server-azure',
    AZURE_ENDPOINT: 'https://azure.example',
    DEEPSEEK_API_KEY: 'sk-server-deepseek',
    OPENAI_API_KEY: 'sk-server-openai',
  }),
}));

const { getModelRuntimeParamsFromPayload } = await import('./index');

const USER_URL = 'https://user.example/v1';
const USER_KEY = 'sk-user-123456';

const providers = [
  { id: ModelProvider.DeepSeek, serverKey: 'sk-server-deepseek' },
  { id: ModelProvider.OpenAI, serverKey: 'sk-server-openai' },
  { id: ModelProvider.Azure, serverKey: 'sk-server-azure' },
  { id: ModelProvider.AzureAI, serverKey: 'sk-server-azureai' },
  { id: ModelProvider.AnthropicCompatible, serverKey: 'sk-server-anthropic-compat' },
] as const;

describe.each(providers)('$id credential merge', ({ id, serverKey }) => {
  it('does not send the server key to a client base URL', () => {
    const result = getModelRuntimeParamsFromPayload(id, { baseURL: USER_URL });

    expect(result.apiKey).toBeFalsy();
    expect(result.apiKey).not.toBe(serverKey);
    expect(result.baseURL).toBe(USER_URL);
  });

  it('uses the server key when the payload has no base URL', () => {
    const result = getModelRuntimeParamsFromPayload(id, {});

    expect(result.apiKey).toBe(serverKey);
  });

  it('keeps a client key together with a client base URL', () => {
    const result = getModelRuntimeParamsFromPayload(id, { apiKey: USER_KEY, baseURL: USER_URL });

    expect(result.apiKey).toBe(USER_KEY);
    expect(result.baseURL).toBe(USER_URL);
  });
});
