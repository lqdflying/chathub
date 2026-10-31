import type { LobeChatDatabase } from '@lobechat/database';

import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { asOptionalString, firstKey } from './parse';
import type { ProviderUsageCredential, ProviderUsageCredentialSource } from './types';

export type ResolvedUsageCredential = {
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
 * used only when the user has none and the operator switch is on. The base
 * URL follows chat: the user's endpoint, else `{PROVIDER}_PROXY_URL`.
 */
export const resolveApiKeyUsageCredential = (
  provider: string,
  vault: Record<string, unknown>,
  env: UsageEnvConfig,
): ResolvedUsageCredential | undefined => {
  const upper = provider.toUpperCase();
  const envBaseURL = asOptionalString(env.values[`${upper}_PROXY_URL`]);
  const userBaseURL = asOptionalString(vault.baseURL) || asOptionalString(vault.endpoint);
  const baseURL = userBaseURL || envBaseURL;

  const userKey = firstKey(vault.apiKey);
  if (userKey) return { credential: { apiKey: userKey, baseURL }, source: 'user' };

  if (!env.serverKeysEnabled) return undefined;
  const serverKey = firstKey(env.values[`${upper}_API_KEY`]);
  if (!serverKey) return undefined;
  return { credential: { apiKey: serverKey, baseURL }, source: 'server' };
};
