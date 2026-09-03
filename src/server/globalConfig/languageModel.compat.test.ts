import { describe, expect, it, vi } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST, OpenAIProviderCard } from '@/config/modelProviders';
import { getAppConfig } from '@/envs/app';
import { getLLMConfig } from '@/envs/llm';

import { genServerLLMConfig } from './_deprecated';
import { getServerGlobalConfig } from './index';
import { parseAgentConfig } from './parseDefaultAgent';

vi.mock('@/const/auth', () => ({
  enableNextAuth: true,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { SYSTEM_AGENT: 'system-agent' },
  getAppConfig: vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: { NEXT_AUTH_SSO_PROVIDERS: 'github, credentials' },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: { S3_SECRET_ACCESS_KEY: undefined },
}));

vi.mock('@/envs/image', () => ({
  imageEnv: { AI_IMAGE_DEFAULT_IMAGE_NUM: 1 },
}));

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: { DEFAULT_FILES_CONFIG: 'test_config' },
}));

vi.mock('@/envs/langfuse', () => ({
  langfuseEnv: { ENABLE_LANGFUSE: false },
}));

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({
    ENABLED_ANTHROPIC: true,
    ENABLED_GOOGLE: true,
    ENABLED_OPENAI: true,
  })),
}));

vi.mock('./genServerAiProviderConfig', () => ({
  genServerAiProvidersConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('./parseDefaultAgent', () => ({
  parseAgentConfig: vi.fn(),
}));

vi.mock('./parseFilesConfig', () => ({
  parseFilesConfig: vi.fn(),
}));

vi.mock('./parseSystemAgent', () => ({
  parseSystemAgent: vi.fn().mockReturnValue({}),
}));

describe('deprecated languageModel compatibility', () => {
  it('derives OpenAI/Google/Anthropic metadata from the 2026 model-bank', () => {
    expect(LOBE_DEFAULT_MODEL_LIST.length).toBeGreaterThan(0);
    expect(LOBE_DEFAULT_MODEL_LIST.map((model) => model.id)).toEqual(
      expect.arrayContaining(['gpt-5.6-sol', 'claude-sonnet-5', 'gemini-3.5-flash-lite']),
    );
    expect(OpenAIProviderCard.chatModels.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);

    vi.stubEnv('OPENAI_MODEL_LIST', 'gpt-5.6-sol');
    const config = genServerLLMConfig({});
    const openaiCards = config.openai.serverModelCards as Array<{ id: string }>;
    expect(openaiCards.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
  });

  it('exposes those derived cards on getServerGlobalConfig().languageModel', async () => {
    vi.mocked(getAppConfig).mockReturnValue({
      ACCESS_CODES: [],
      DEFAULT_AGENT_CONFIG: '',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue({});
    vi.mocked(getLLMConfig).mockReturnValue({
      ENABLED_ANTHROPIC: true,
      ENABLED_GOOGLE: true,
      ENABLED_OPENAI: true,
    } as any);
    vi.stubEnv('OPENAI_MODEL_LIST', 'gpt-5.6-sol');

    const result = await getServerGlobalConfig();
    const openaiCards = result.languageModel?.openai?.serverModelCards as
      | Array<{ id: string }>
      | undefined;

    expect(openaiCards?.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
  });
});
