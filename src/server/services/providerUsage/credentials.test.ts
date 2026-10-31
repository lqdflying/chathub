import { describe, expect, it, vi } from 'vitest';

vi.mock('@/database/models/aiProvider', () => ({ AiProviderModel: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: {} }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({ KeyVaultsGateKeeper: {} }));

const {
  parseStoredAdminCredential,
  resolveAdminUsageCredential,
  resolveApiKeyUsageCredential,
  serializeStoredAdminCredential,
} = await import('./credentials');

const env = (serverKeysEnabled: boolean, values: Record<string, string> = {}) => ({
  serverKeysEnabled,
  values,
});

describe('resolveApiKeyUsageCredential', () => {
  it('prefers the user key and takes only the first of a comma list', () => {
    expect(
      resolveApiKeyUsageCredential(
        'deepseek',
        { apiKey: ' sk-user-a , sk-user-b', baseURL: 'https://user.example.com/v1' },
        env(true, { DEEPSEEK_API_KEY: 'sk-server' }),
      ),
    ).toEqual({
      allowPrivateHost: undefined,
      credential: { apiKey: 'sk-user-a', baseURL: 'https://user.example.com/v1' },
      source: 'user',
    });
  });

  it('falls back to the env proxy URL for a user key without an endpoint', () => {
    expect(
      resolveApiKeyUsageCredential(
        'moonshot',
        { apiKey: 'sk-user' },
        env(false, { MOONSHOT_PROXY_URL: 'https://api.moonshot.ai/v1' }),
      ),
    ).toEqual({
      allowPrivateHost: 'api.moonshot.ai',
      credential: { apiKey: 'sk-user', baseURL: 'https://api.moonshot.ai/v1' },
      source: 'user',
    });
  });

  it('never uses the server key while the operator switch is off', () => {
    expect(
      resolveApiKeyUsageCredential('deepseek', {}, env(false, { DEEPSEEK_API_KEY: 'sk-server' })),
    ).toBeUndefined();
  });

  it('uses the first server key when the switch is on and the user has none', () => {
    expect(
      resolveApiKeyUsageCredential(
        'deepseek',
        { apiKey: '' },
        env(true, { DEEPSEEK_API_KEY: 'sk-server-a,sk-server-b' }),
      ),
    ).toEqual({
      allowPrivateHost: undefined,
      credential: { apiKey: 'sk-server-a', baseURL: undefined },
      source: 'server',
    });
  });

  it('does not send the server key to a user endpoint', () => {
    expect(
      resolveApiKeyUsageCredential(
        'deepseek',
        { baseURL: 'https://user.example/v1' },
        env(true, {
          DEEPSEEK_API_KEY: 'sk-server',
          DEEPSEEK_PROXY_URL: 'https://proxy.example/v1',
        }),
      ),
    ).toEqual({
      allowPrivateHost: 'proxy.example',
      credential: { apiKey: 'sk-server', baseURL: 'https://proxy.example/v1' },
      source: 'server',
    });
  });

  it('returns nothing when neither the user nor the server has a key', () => {
    expect(resolveApiKeyUsageCredential('deepseek', {}, env(true))).toBeUndefined();
  });
});

describe('admin usage credentials', () => {
  it('round-trips the stored JSON and rejects malformed plaintext', () => {
    const plaintext = serializeStoredAdminCredential({ apiKey: 'xai-mgmt-key', teamId: 'team-1' });
    expect(parseStoredAdminCredential(plaintext)).toEqual({
      apiKey: 'xai-mgmt-key',
      teamId: 'team-1',
    });
    expect(parseStoredAdminCredential('not json')).toBeUndefined();
    expect(parseStoredAdminCredential('{"apiKey":""}')).toBeUndefined();
  });

  it('prefers the saved key over the operator env key', () => {
    expect(
      resolveAdminUsageCredential(
        'openai',
        { apiKey: 'sk-admin-user' },
        env(true, { OPENAI_ADMIN_API_KEY: 'sk-admin-server' }),
      ),
    ).toEqual({ credential: { apiKey: 'sk-admin-user', teamId: undefined }, source: 'user' });
  });

  it('uses the operator admin key and team only when the switch is on', () => {
    const values = { XAI_MANAGEMENT_API_KEY: 'xai-server', XAI_MANAGEMENT_TEAM_ID: 'team-ops' };
    expect(resolveAdminUsageCredential('xai', undefined, env(false, values))).toBeUndefined();
    expect(resolveAdminUsageCredential('xai', undefined, env(true, values))).toEqual({
      credential: { apiKey: 'xai-server', teamId: 'team-ops' },
      source: 'server',
    });
  });

  it('ignores the chat API key env name for admin providers', () => {
    expect(
      resolveAdminUsageCredential('anthropic', undefined, env(true, { ANTHROPIC_API_KEY: 'x' })),
    ).toBeUndefined();
  });
});
