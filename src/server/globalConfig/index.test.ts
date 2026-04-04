import { describe, expect, it, vi } from 'vitest';

import { enableNextAuth } from '@/const/auth';
import { getAppConfig } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { fileEnv } from '@/envs/file';
import { imageEnv } from '@/envs/image';
import { SystemEmbeddingConfig } from '@/types/knowledgeBase';
import { FilesConfigItem } from '@/types/user/settings/filesConfig';

import { getServerDefaultAgentConfig, getServerDefaultFilesConfig, getServerGlobalConfig } from './index';
import { genServerLLMConfig } from './_deprecated';
import { genServerAiProvidersConfig } from './genServerAiProviderConfig';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';
import { parseSystemAgent } from './parseSystemAgent';

vi.mock('@/const/auth', () => ({
  enableNextAuth: true,
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    SYSTEM_AGENT: 'system-agent',
  },
  getAppConfig: vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    NEXT_AUTH_SSO_PROVIDERS: 'github, credentials',
  },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: {
    S3_SECRET_ACCESS_KEY: undefined,
  },
}));

vi.mock('@/envs/image', () => ({
  imageEnv: {
    AI_IMAGE_DEFAULT_IMAGE_NUM: 1,
  },
}));

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    DEFAULT_FILES_CONFIG: 'test_config',
  },
}));

vi.mock('@/envs/langfuse', () => ({
  langfuseEnv: {
    ENABLE_LANGFUSE: false,
  },
}));

vi.mock('./_deprecated', () => ({
  genServerLLMConfig: vi.fn().mockReturnValue({}),
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

describe('getServerDefaultAgentConfig', () => {
  it('should return parsed agent config', () => {
    const mockConfig = { key: 'value' };
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultAgentConfig();

    expect(parseAgentConfig).toHaveBeenCalledWith('test_agent_config');
    expect(result).toEqual(mockConfig);
  });

  it('should return empty object if parseAgentConfig returns undefined', () => {
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(undefined);

    const result = getServerDefaultAgentConfig();

    expect(result).toEqual({});
  });
});

describe('getServerDefaultFilesConfig', () => {
  it('should return parsed files config', () => {
    const mockEmbeddingModel: FilesConfigItem = {
      model: 'test-model',
      provider: 'test-provider',
    };

    const mockRerankerModel: FilesConfigItem = {
      model: 'test-reranker',
      provider: 'test-provider',
    };

    const mockConfig: SystemEmbeddingConfig = {
      embeddingModel: mockEmbeddingModel,
      queryMode: 'hybrid',
      rerankerModel: mockRerankerModel,
    };

    vi.mocked(parseFilesConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultFilesConfig();

    expect(parseFilesConfig).toHaveBeenCalledWith('test_config');
    expect(result).toEqual(mockConfig);
  });
});

describe('getServerGlobalConfig', () => {
  it('normalizes oauth provider tokens for the sign-in UI', async () => {
    vi.mocked(getAppConfig).mockReturnValue({
      ACCESS_CODES: [],
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue({});

    const result = await getServerGlobalConfig();

    expect(enableNextAuth).toBe(true);
    expect(authEnv.NEXT_AUTH_SSO_PROVIDERS).toBe('github, credentials');
    expect(result.oAuthSSOProviders).toEqual(['github', 'credentials']);
    expect(genServerAiProvidersConfig).toHaveBeenCalled();
    expect(genServerLLMConfig).toHaveBeenCalled();
    expect(parseSystemAgent).toHaveBeenCalledWith('system-agent');
    expect(fileEnv.S3_SECRET_ACCESS_KEY).toBeUndefined();
    expect(imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM).toBe(1);
  });
});
