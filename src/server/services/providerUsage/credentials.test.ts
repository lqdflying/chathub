import { describe, expect, it, vi } from 'vitest';

vi.mock('@/database/models/aiProvider', () => ({ AiProviderModel: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: {} }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({ KeyVaultsGateKeeper: {} }));

const { resolveApiKeyUsageCredential } = await import('./credentials');

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
    ).toEqual({ credential: { apiKey: 'sk-server-a', baseURL: undefined }, source: 'server' });
  });

  it('returns nothing when neither the user nor the server has a key', () => {
    expect(resolveApiKeyUsageCredential('deepseek', {}, env(true))).toBeUndefined();
  });
});
