// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLLMConfig } from '@/envs/llm';

import { createOpenAIAudioClient } from './openaiAudio';

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(),
}));

describe('createOpenAIAudioClient', () => {
  beforeEach(() => {
    vi.mocked(getLLMConfig).mockReturnValue({
      OPENAI_API_KEY: 'server-openai-key',
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pairs a client API key with its client-provided base URL', () => {
    vi.stubEnv('OPENAI_PROXY_URL', 'https://server-openai-proxy.example/v1');

    const client = createOpenAIAudioClient({
      apiKey: 'client-openai-key',
      baseURL: 'https://client-openai-proxy.example/v1',
    });

    expect(client.apiKey).toBe('client-openai-key');
    expect(client.baseURL).toBe('https://client-openai-proxy.example/v1');
  });

  it('never sends the server API key to a client-provided base URL', () => {
    vi.stubEnv('OPENAI_PROXY_URL', 'https://server-openai-proxy.example/v1');

    const client = createOpenAIAudioClient({
      baseURL: 'https://attacker.example/v1',
    });

    expect(client.apiKey).toBe('server-openai-key');
    expect(client.baseURL).toBe('https://server-openai-proxy.example/v1');
  });

  it('uses the OpenAI default when no server-controlled proxy is configured', () => {
    vi.stubEnv('OPENAI_PROXY_URL', '');

    const client = createOpenAIAudioClient({
      baseURL: 'https://attacker.example/v1',
    });

    expect(client.apiKey).toBe('server-openai-key');
    expect(client.baseURL).toBe('https://api.openai.com/v1');
  });
});
