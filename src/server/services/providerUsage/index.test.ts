import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/models/aiProvider', () => ({ AiProviderModel: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: {} }));
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
