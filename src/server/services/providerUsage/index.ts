import type { LobeChatDatabase } from '@lobechat/database';
import { createHash } from 'node:crypto';

import { ProviderUsageCredentialModel } from '@/database/models/providerUsageCredential';
import { getLLMConfig } from '@/envs/llm';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { getProviderUsageAdapter } from './adapters';
import { discoverXaiTeamId } from './adapters/xai';
import {
  type ResolvedUsageCredential,
  type StoredAdminCredential,
  type UsageEnvConfig,
  loadUserProviderVault,
  parseStoredAdminCredential,
  resolveAdminUsageCredential,
  resolveApiKeyUsageCredential,
  serializeStoredAdminCredential,
} from './credentials';
import { toKeyHint } from './parse';
import type {
  ProviderUsageAdapterResult,
  ProviderUsageSnapshot,
  ProviderUsageStoredCredential,
} from './types';

export const PROVIDER_USAGE_TIMEOUT_MS = 10_000;
export const PROVIDER_USAGE_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const CACHE_KEY_SEPARATOR = '\u0000';

type CacheEntry = { expiresAt: number; snapshot: ProviderUsageSnapshot };

const usageCache = new Map<string, CacheEntry>();

/** Test hook. */
export const clearProviderUsageCache = () => usageCache.clear();

const clearCachedUsage = (userId: string, provider: string) => {
  const prefix = `${userId}${CACHE_KEY_SEPARATOR}${provider}${CACHE_KEY_SEPARATOR}`;
  for (const key of usageCache.keys()) {
    if (key.startsWith(prefix)) usageCache.delete(key);
  }
};

const pruneCache = (nowMs: number) => {
  if (usageCache.size < CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of usageCache) {
    if (entry.expiresAt <= nowMs) usageCache.delete(key);
  }
  if (usageCache.size >= CACHE_MAX_ENTRIES) usageCache.clear();
};

/** Full-key digest so two keys with the same last four characters never share a cache slot. */
const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 24);

/** `{PROVIDER}_API_KEY` / `{PROVIDER}_PROXY_URL` are read straight from the process env. */
export const readUsageEnvConfig = (): UsageEnvConfig => ({
  serverKeysEnabled: getLLMConfig().ENABLE_PROVIDER_USAGE_SERVER_KEYS === true,
  values: process.env,
});

export type ProviderUsageCredentialStore = {
  delete: (provider: string) => Promise<void>;
  find: (provider: string) => Promise<{ credential: string; keyHint: string } | undefined>;
  upsert: (value: { credential: string; keyHint: string; provider: string }) => Promise<void>;
};

export type ProviderUsageCrypto = {
  decrypt: (value: string) => Promise<{ plaintext: string; wasAuthentic: boolean }>;
  encrypt: (value: string) => Promise<string>;
};

export type ProviderUsageServiceOptions = {
  credentialStore?: ProviderUsageCredentialStore;
  crypto?: ProviderUsageCrypto;
  env?: UsageEnvConfig;
  fetchFn?: typeof fetch;
  loadVault?: (provider: string) => Promise<Record<string, unknown>>;
  now?: () => Date;
  resolveHost?: (hostname: string) => Promise<string[]>;
};

export class ProviderUsageAdminProviderError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" does not take an admin usage key`);
    this.name = 'ProviderUsageAdminProviderError';
  }
}

export class ProviderUsageService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly options: ProviderUsageServiceOptions;
  private crypto?: ProviderUsageCrypto;

  constructor(db: LobeChatDatabase, userId: string, options: ProviderUsageServiceOptions = {}) {
    this.db = db;
    this.userId = userId;
    this.options = options;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.crypto = options.crypto;
  }

  private get env(): UsageEnvConfig {
    return this.options.env ?? readUsageEnvConfig();
  }

  private get credentialStore(): ProviderUsageCredentialStore {
    return this.options.credentialStore ?? new ProviderUsageCredentialModel(this.db, this.userId);
  }

  private async getCrypto(): Promise<ProviderUsageCrypto> {
    if (this.crypto) return this.crypto;
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    this.crypto = {
      decrypt: (value) => gateKeeper.decrypt(value),
      encrypt: (value) => gateKeeper.encrypt(value),
    };
    return this.crypto;
  }

  private async loadVault(provider: string) {
    if (this.options.loadVault) return this.options.loadVault(provider);
    return loadUserProviderVault(this.db, this.userId, provider);
  }

  /** Fail-soft: a missing table or a bad ciphertext reads as "no saved key". */
  private async loadStoredAdmin(
    provider: string,
  ): Promise<{ hint: ProviderUsageStoredCredential; stored: StoredAdminCredential } | undefined> {
    try {
      const row = await this.credentialStore.find(provider);
      if (!row) return undefined;
      const crypto = await this.getCrypto();
      const decrypted = await crypto.decrypt(row.credential);
      if (!decrypted.wasAuthentic) return undefined;
      const stored = parseStoredAdminCredential(decrypted.plaintext);
      if (!stored) return undefined;
      return {
        hint: { keyHint: row.keyHint, ...(stored.teamId ? { teamId: stored.teamId } : {}) },
        stored,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Fail-soft: vendor, network, and parse failures become a status, never a
   * thrown error, so the settings page keeps rendering.
   */
  async getUsage(
    provider: string,
    options: { force?: boolean } = {},
  ): Promise<ProviderUsageSnapshot | undefined> {
    const adapter = getProviderUsageAdapter(provider);
    if (!adapter) return undefined;

    const now = this.now();
    let resolved: ResolvedUsageCredential | undefined;
    let storedCredential: ProviderUsageStoredCredential | undefined;

    if (adapter.credentialType === 'admin') {
      const stored = await this.loadStoredAdmin(provider);
      storedCredential = stored?.hint;
      resolved = resolveAdminUsageCredential(provider, stored?.stored, this.env);
    } else {
      resolved = resolveApiKeyUsageCredential(provider, await this.loadVault(provider), this.env);
    }

    const base = {
      credentialType: adapter.credentialType,
      fetchedAt: now.toISOString(),
      provider,
      ...(storedCredential ? { storedCredential } : {}),
    } satisfies Partial<ProviderUsageSnapshot>;

    if (!resolved) return { ...base, status: 'noCredential' };

    const keyHint = toKeyHint(resolved.credential.apiKey);
    const cacheKey = [
      this.userId,
      provider,
      resolved.source,
      keyFingerprint(resolved.credential.apiKey),
      resolved.credential.baseURL ?? '',
      resolved.credential.teamId ?? '',
    ].join(CACHE_KEY_SEPARATOR);

    const nowMs = now.getTime();
    const cached = usageCache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > nowMs) return cached.snapshot;

    let result: ProviderUsageAdapterResult;
    try {
      result = await adapter.fetchUsage({
        allowPrivateHost: resolved.allowPrivateHost,
        credential: resolved.credential,
        fetchFn: this.fetchFn,
        now,
        resolveHost: this.options.resolveHost,
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
    if (snapshot.status !== 'error') {
      usageCache.set(cacheKey, { expiresAt: nowMs + PROVIDER_USAGE_CACHE_TTL_MS, snapshot });
    }
    return snapshot;
  }

  /** xAI will not keep a management key that still has no team id. */
  private async resolveXaiTeamId(apiKey: string): Promise<string | ProviderUsageSnapshot> {
    const now = this.now();
    const base = {
      credentialType: 'admin' as const,
      fetchedAt: now.toISOString(),
      provider: 'xai',
    };
    try {
      const discovered = await discoverXaiTeamId(
        {
          credential: { apiKey },
          fetchFn: this.fetchFn,
          now,
          resolveHost: this.options.resolveHost,
          timeoutMs: PROVIDER_USAGE_TIMEOUT_MS,
        },
        apiKey,
      );
      if ('teamId' in discovered) return discovered.teamId;
      return { ...base, ...discovered };
    } catch {
      return { ...base, status: 'error' };
    }
  }

  private assertAdminProvider(provider: string) {
    if (getProviderUsageAdapter(provider)?.credentialType !== 'admin') {
      throw new ProviderUsageAdminProviderError(provider);
    }
  }

  /** Stores the key encrypted server-side; only its hint is ever returned. */
  async saveAdminCredential(provider: string, input: { apiKey: string; teamId?: string }) {
    this.assertAdminProvider(provider);
    const apiKey = input.apiKey.trim();
    let teamId = input.teamId?.trim() || undefined;
    if (provider === 'xai' && !teamId) {
      const resolvedTeamId = await this.resolveXaiTeamId(apiKey);
      if (typeof resolvedTeamId !== 'string') return resolvedTeamId;
      teamId = resolvedTeamId;
    }
    const crypto = await this.getCrypto();
    await this.credentialStore.upsert({
      credential: await crypto.encrypt(serializeStoredAdminCredential({ apiKey, teamId })),
      keyHint: toKeyHint(apiKey),
      provider,
    });
    clearCachedUsage(this.userId, provider);
    return this.getUsage(provider, { force: true });
  }

  async deleteAdminCredential(provider: string) {
    this.assertAdminProvider(provider);
    await this.credentialStore.delete(provider);
    clearCachedUsage(this.userId, provider);
    return this.getUsage(provider, { force: true });
  }
}
