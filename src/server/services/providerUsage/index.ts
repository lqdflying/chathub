import type { LobeChatDatabase } from '@lobechat/database';

import { getLLMConfig } from '@/envs/llm';

import { getProviderUsageAdapter } from './adapters';
import {
  type ResolvedUsageCredential,
  type UsageEnvConfig,
  loadUserProviderVault,
  resolveApiKeyUsageCredential,
} from './credentials';
import { toKeyHint } from './parse';
import type { ProviderUsageAdapterResult, ProviderUsageSnapshot } from './types';

export const PROVIDER_USAGE_TIMEOUT_MS = 10_000;
export const PROVIDER_USAGE_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

type CacheEntry = { expiresAt: number; snapshot: ProviderUsageSnapshot };

const usageCache = new Map<string, CacheEntry>();

/** Test hook. */
export const clearProviderUsageCache = () => usageCache.clear();

const pruneCache = (nowMs: number) => {
  if (usageCache.size < CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of usageCache) {
    if (entry.expiresAt <= nowMs) usageCache.delete(key);
  }
  if (usageCache.size >= CACHE_MAX_ENTRIES) usageCache.clear();
};

/** `{PROVIDER}_API_KEY` / `{PROVIDER}_PROXY_URL` are read straight from the process env. */
export const readUsageEnvConfig = (): UsageEnvConfig => ({
  serverKeysEnabled: getLLMConfig().ENABLE_PROVIDER_USAGE_SERVER_KEYS === true,
  values: process.env,
});

export type ProviderUsageServiceOptions = {
  env?: UsageEnvConfig;
  fetchFn?: typeof fetch;
  loadVault?: (provider: string) => Promise<Record<string, unknown>>;
  now?: () => Date;
};

export class ProviderUsageService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly options: ProviderUsageServiceOptions;

  constructor(db: LobeChatDatabase, userId: string, options: ProviderUsageServiceOptions = {}) {
    this.db = db;
    this.userId = userId;
    this.options = options;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private get env(): UsageEnvConfig {
    return this.options.env ?? readUsageEnvConfig();
  }

  private async loadVault(provider: string) {
    if (this.options.loadVault) return this.options.loadVault(provider);
    return loadUserProviderVault(this.db, this.userId, provider);
  }

  private async resolveCredential(
    provider: string,
  ): Promise<ResolvedUsageCredential | undefined> {
    return resolveApiKeyUsageCredential(provider, await this.loadVault(provider), this.env);
  }

  /**
   * Fail-soft: vendor, network, and parse failures become a status, never a
   * thrown error, so the settings page keeps rendering.
   */
  async getUsage(provider: string, options: { force?: boolean } = {}) {
    const adapter = getProviderUsageAdapter(provider);
    if (!adapter) return undefined;

    const now = this.now();
    const base = {
      credentialType: adapter.credentialType,
      fetchedAt: now.toISOString(),
      provider,
    } satisfies Partial<ProviderUsageSnapshot>;

    const resolved = await this.resolveCredential(provider);
    if (!resolved) return { ...base, status: 'noCredential' } satisfies ProviderUsageSnapshot;

    const keyHint = toKeyHint(resolved.credential.apiKey);
    const cacheKey = [
      this.userId,
      provider,
      resolved.source,
      keyHint,
      resolved.credential.baseURL ?? '',
      resolved.credential.teamId ?? '',
    ].join('\u0000');

    const nowMs = now.getTime();
    const cached = usageCache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > nowMs) return cached.snapshot;

    let result: ProviderUsageAdapterResult;
    try {
      result = await adapter.fetchUsage({
        credential: resolved.credential,
        fetchFn: this.fetchFn,
        now,
        timeoutMs: PROVIDER_USAGE_TIMEOUT_MS,
      });
    } catch {
      result = { status: 'error' };
    }

    const snapshot: ProviderUsageSnapshot = {
      ...base,
      ...result,
      credentialSource: resolved.source,
      keyHint,
    };

    pruneCache(nowMs);
    usageCache.set(cacheKey, { expiresAt: nowMs + PROVIDER_USAGE_CACHE_TTL_MS, snapshot });
    return snapshot;
  }
}
