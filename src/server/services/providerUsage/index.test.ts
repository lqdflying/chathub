import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/models/aiProvider', () => ({ AiProviderModel: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: {} }));
vi.mock('@/database/models/providerUsageCredential', () => ({
  ProviderUsageCredentialModel: class {},
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({ KeyVaultsGateKeeper: {} }));
vi.mock('@/envs/llm', () => ({
  getLLMConfig: () => ({ ENABLE_PROVIDER_USAGE_SERVER_KEYS: false }),
}));

const { ProviderUsageService, clearProviderUsageCache, PROVIDER_USAGE_CACHE_TTL_MS } =
  await import('./index');

const balanceResponse = () =>
  new Response(
    JSON.stringify({
      balance_infos: [{ currency: 'CNY', total_balance: '1.50' }],
      is_available: true,
    }),
    { status: 200 },
  );

const createService = (
  options: {
    fetchFn?: typeof fetch;
    now?: () => Date;
    serverKeysEnabled?: boolean;
    vault?: Record<string, unknown>;
  } = {},
) =>
  new ProviderUsageService({} as never, 'user-1', {
    env: {
      serverKeysEnabled: options.serverKeysEnabled ?? false,
      values: { DEEPSEEK_API_KEY: 'sk-server-key-123456' },
    },
    fetchFn: options.fetchFn ?? (vi.fn(async () => balanceResponse()) as never),
    loadVault: async () => options.vault ?? {},
    now: options.now ?? (() => new Date('2026-10-31T00:00:00Z')),
  });

describe('ProviderUsageService', () => {
  beforeEach(() => clearProviderUsageCache());

  it('returns undefined for a provider without an adapter', async () => {
    await expect(createService().getUsage('openaicompatible')).resolves.toBeUndefined();
  });

  it('reports noCredential without calling the vendor when the server switch is off', async () => {
    const fetchFn = vi.fn();
    const snapshot = await createService({ fetchFn: fetchFn as never }).getUsage('deepseek');
    expect(snapshot).toMatchObject({ provider: 'deepseek', status: 'noCredential' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads the server key when the switch is on and marks the source', async () => {
    const snapshot = await createService({ serverKeysEnabled: true }).getUsage('deepseek');
    expect(snapshot).toMatchObject({
      balances: [{ currency: 'CNY', total: 1.5 }],
      credentialSource: 'server',
      keyHint: '****3456',
      status: 'ok',
    });
  });

  it('caches per key and bypasses the cache on force', async () => {
    const fetchFn = vi.fn(async () => balanceResponse());
    let nowMs = Date.parse('2026-10-31T00:00:00Z');
    const service = createService({
      fetchFn: fetchFn as never,
      now: () => new Date(nowMs),
      vault: { apiKey: 'sk-user-key-abcdef' },
    });

    await service.getUsage('deepseek');
    await service.getUsage('deepseek');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await service.getUsage('deepseek', { force: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    nowMs += PROVIDER_USAGE_CACHE_TTL_MS + 1;
    await service.getUsage('deepseek');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('turns a network failure into an error status instead of throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const snapshot = await createService({
      fetchFn: fetchFn as never,
      vault: { apiKey: 'sk-user-key-abcdef' },
    }).getUsage('deepseek');
    expect(snapshot).toMatchObject({ credentialSource: 'user', status: 'error' });
  });
});

describe('ProviderUsageService admin keys', () => {
  beforeEach(() => clearProviderUsageCache());

  const createAdminService = (fetchFn: typeof fetch, serverKeysEnabled = false) => {
    const rows = new Map<string, { credential: string; keyHint: string }>();
    const crypto = {
      decrypt: async (value: string) =>
        value.startsWith('enc:')
          ? { plaintext: value.slice(4), wasAuthentic: true }
          : { plaintext: '', wasAuthentic: false },
      encrypt: async (value: string) => `enc:${value}`,
    };
    const service = new ProviderUsageService({} as never, 'user-1', {
      credentialStore: {
        delete: async (provider) => void rows.delete(provider),
        find: async (provider) => rows.get(provider),
        upsert: async ({ credential, keyHint, provider }) =>
          void rows.set(provider, { credential, keyHint }),
      },
      crypto,
      env: { serverKeysEnabled, values: { OPENAI_ADMIN_API_KEY: 'sk-admin-server-key-0000' } },
      fetchFn,
      loadVault: async () => ({ apiKey: 'sk-chat-key-must-not-be-used' }),
      now: () => new Date('2026-10-31T00:00:00Z'),
    });
    return { rows, service };
  };

  const costs = () =>
    new Response(JSON.stringify({ data: [{ results: [{ amount: { value: 3 } }] }] }), {
      status: 200,
    });

  it('never falls back to the chat API key for an admin provider', async () => {
    const fetchFn = vi.fn(async () => costs());
    const { service } = createAdminService(fetchFn as never);
    await expect(service.getUsage('openai')).resolves.toMatchObject({
      credentialType: 'admin',
      status: 'noCredential',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('encrypts a saved key, returns only its hint, and reads spend with it', async () => {
    const fetchFn = vi.fn(async () => costs());
    const { rows, service } = createAdminService(fetchFn as never);

    const snapshot = await service.saveAdminCredential('openai', {
      apiKey: '  sk-admin-user-key-9876  ',
    });

    expect(rows.get('openai')?.credential).toBe('enc:{"apiKey":"sk-admin-user-key-9876"}');
    expect(JSON.stringify(snapshot)).not.toContain('sk-admin-user-key-9876');
    expect(snapshot).toMatchObject({
      credentialSource: 'user',
      keyHint: '****9876',
      spend: { amount: 3, currency: 'USD' },
      status: 'ok',
      storedCredential: { keyHint: '****9876' },
    });
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk-admin-user-key-9876',
    });
  });

  it('falls back to the operator admin key after the user removes theirs', async () => {
    const fetchFn = vi.fn(async () => costs());
    const { rows, service } = createAdminService(fetchFn as never, true);
    await service.saveAdminCredential('openai', { apiKey: 'sk-admin-user-key-9876' });

    const snapshot = await service.deleteAdminCredential('openai');
    expect(rows.has('openai')).toBe(false);
    expect(snapshot).toMatchObject({ credentialSource: 'server', keyHint: '****0000' });
    expect(snapshot?.storedCredential).toBeUndefined();
  });

  it('treats an unreadable ciphertext as no saved key', async () => {
    const fetchFn = vi.fn(async () => costs());
    const { rows, service } = createAdminService(fetchFn as never);
    rows.set('openai', { credential: 'tampered', keyHint: '****1111' });
    await expect(service.getUsage('openai')).resolves.toMatchObject({ status: 'noCredential' });
  });

  it('refuses to store an admin key for an API-key provider', async () => {
    const { service } = createAdminService(vi.fn() as never);
    await expect(
      service.saveAdminCredential('deepseek', { apiKey: 'sk-12345678' }),
    ).rejects.toThrow('does not take an admin usage key');
  });
});
