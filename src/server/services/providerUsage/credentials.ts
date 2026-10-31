import type { LobeChatDatabase } from '@lobechat/database';

import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { asOptionalString, firstKey, safeHostname } from './parse';
import type { ProviderUsageCredential, ProviderUsageCredentialSource } from './types';

export type ResolvedUsageCredential = {
  /**
   * Set only when the base URL is the operator `{PROVIDER}_PROXY_URL`.
   * A user-entered endpoint never receives this exception.
   */
  allowPrivateHost?: string;
  credential: ProviderUsageCredential;
  source: ProviderUsageCredentialSource;
};

export type UsageEnvConfig = {
  /** Operator switch: allow usage reads with server environment keys. */
  serverKeysEnabled: boolean;
  values: Record<string, string | undefined>;
};

/**
 * Same merge order as chat credential resolution: legacy per-user settings
 * vault first, then the provider row's key vault.
 */
export const loadUserProviderVault = async (
  db: LobeChatDatabase,
  userId: string,
  provider: string,
): Promise<Record<string, unknown>> => {
  let legacy: Record<string, unknown> = {};
  try {
    const keys = await UserModel.getUserApiKeys(db, userId, KeyVaultsGateKeeper.getUserKeyVaults);
    legacy = ((keys as Record<string, unknown>)?.[provider] as Record<string, unknown>) || {};
  } catch {
    legacy = {};
  }

  let current: Record<string, unknown> = {};
  try {
    const runtime = await new AiProviderModel(db, userId).getAiProviderRuntimeConfig(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    current = (runtime[provider]?.keyVaults as Record<string, unknown>) || {};
  } catch {
    current = {};
  }

  return { ...legacy, ...current };
};

/**
 * A key the user entered always wins. The server's `{PROVIDER}_API_KEY` is
 * used only when the user has none and the operator switch is on.
 * A user endpoint is sent only with that user's key. A server key uses
 * `{PROVIDER}_PROXY_URL` and never the endpoint saved on the provider.
 */
export const resolveApiKeyUsageCredential = (
  provider: string,
  vault: Record<string, unknown>,
  env: UsageEnvConfig,
): ResolvedUsageCredential | undefined => {
  const upper = provider.toUpperCase();
  const envBaseURL = asOptionalString(env.values[`${upper}_PROXY_URL`]);
  const userBaseURL = asOptionalString(vault.baseURL) || asOptionalString(vault.endpoint);
  const operatorHost = envBaseURL ? safeHostname(envBaseURL) : undefined;

  const userKey = firstKey(vault.apiKey);
  if (userKey) {
    return {
      allowPrivateHost: userBaseURL ? undefined : operatorHost,
      credential: { apiKey: userKey, baseURL: userBaseURL || envBaseURL },
      source: 'user',
    };
  }

  if (!env.serverKeysEnabled) return undefined;
  const serverKey = firstKey(env.values[`${upper}_API_KEY`]);
  if (!serverKey) return undefined;
  return {
    allowPrivateHost: operatorHost,
    credential: { apiKey: serverKey, baseURL: envBaseURL },
    source: 'server',
  };
};

/** Operator env names for admin / management keys, gated by the same switch. */
export const ADMIN_USAGE_ENV_KEYS: Record<string, { apiKey: string; teamId?: string }> = {
  anthropic: { apiKey: 'ANTHROPIC_ADMIN_API_KEY' },
  openai: { apiKey: 'OPENAI_ADMIN_API_KEY' },
  xai: { apiKey: 'XAI_MANAGEMENT_API_KEY', teamId: 'XAI_MANAGEMENT_TEAM_ID' },
};

export type StoredAdminCredential = {
  apiKey: string;
  teamId?: string;
};

export const serializeStoredAdminCredential = (credential: StoredAdminCredential) =>
  JSON.stringify({
    apiKey: credential.apiKey,
    ...(credential.teamId ? { teamId: credential.teamId } : {}),
  });

export const parseStoredAdminCredential = (
  plaintext: string,
): StoredAdminCredential | undefined => {
  try {
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    const apiKey = asOptionalString(parsed.apiKey);
    if (!apiKey) return undefined;
    const teamId = asOptionalString(parsed.teamId);
    return teamId ? { apiKey, teamId } : { apiKey };
  } catch {
    return undefined;
  }
};

/**
 * The user's saved admin key wins. Operator env admin keys are used only when
 * the user saved none and ENABLE_PROVIDER_USAGE_SERVER_KEYS is on.
 */
export const resolveAdminUsageCredential = (
  provider: string,
  stored: StoredAdminCredential | undefined,
  env: UsageEnvConfig,
): ResolvedUsageCredential | undefined => {
  if (stored?.apiKey) {
    return { credential: { apiKey: stored.apiKey, teamId: stored.teamId }, source: 'user' };
  }
  if (!env.serverKeysEnabled) return undefined;

  const names = ADMIN_USAGE_ENV_KEYS[provider];
  if (!names) return undefined;
  const apiKey = firstKey(env.values[names.apiKey]);
  if (!apiKey) return undefined;
  const teamId = names.teamId ? asOptionalString(env.values[names.teamId]) : undefined;
  return { credential: { apiKey, ...(teamId ? { teamId } : {}) }, source: 'server' };
};
