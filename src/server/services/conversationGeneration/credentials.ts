import type { ClientSecretPayload } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { TRPCError } from '@trpc/server';

import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getModelRuntimeParamsFromPayload } from '@/server/modules/ModelRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ProviderConfig } from '@/types/user/settings';

import { FETCH_ON_CLIENT_ERROR } from './constants';

const firstKey = (value?: string) => value?.split(',')[0]?.trim() || undefined;

const providerPayloadFromVault = (provider: string, vault: Record<string, any> = {}) => {
  switch (provider) {
    case ModelProvider.Azure: {
      return {
        apiKey: firstKey(vault.apiKey),
        apiVersion: vault.apiVersion,
        azureApiVersion: vault.apiVersion,
        baseURL: vault.baseURL || vault.endpoint,
      };
    }
    case ModelProvider.AnthropicCompatible: {
      return {
        apiKey: firstKey(vault.apiKey),
        authType: vault.authMode,
        baseURL: vault.baseURL,
      };
    }
    default: {
      return {
        apiKey: firstKey(vault.apiKey),
        baseURL: vault.baseURL,
      };
    }
  }
};

export const resolveConversationRuntimePayload = async ({
  db,
  fetchOnClient,
  provider,
  userId,
}: {
  db: LobeChatDatabase;
  fetchOnClient?: boolean;
  provider: string;
  userId: string;
}): Promise<ClientSecretPayload> => {
  const { aiProvider } = await getServerGlobalConfig();
  const aiInfraRepos = new AiInfraRepos(
    db,
    userId,
    aiProvider as Record<string, ProviderConfig>,
  );
  const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
    KeyVaultsGateKeeper.getUserKeyVaults,
  );
  const providerRuntime = runtimeState.runtimeConfig?.[provider];
  const isBuiltin = Object.values(ModelProvider).includes(provider as ModelProvider);
  const runtimeProvider = isBuiltin
    ? provider
    : providerRuntime?.settings?.sdkType || ModelProvider.OpenAI;

  let userVaults: Record<string, any> = {};
  try {
    const keys = await UserModel.getUserApiKeys(db, userId, KeyVaultsGateKeeper.getUserKeyVaults);
    userVaults = (keys as Record<string, any>)?.[provider] || {};
  } catch {
    userVaults = {};
  }

  const vault = {
    ...userVaults,
    ...(providerRuntime?.keyVaults || {}),
  };
  const payload = {
    runtimeProvider,
    userId,
    ...providerPayloadFromVault(runtimeProvider, vault),
  } as ClientSecretPayload;

  const runtimeParams = getModelRuntimeParamsFromPayload(runtimeProvider, payload);
  const hasCredential = Boolean(
    payload.apiKey || payload.baseURL || runtimeParams.apiKey || runtimeParams.baseURL,
  );
  if ((fetchOnClient || providerRuntime?.fetchOnClient) && !hasCredential) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: FETCH_ON_CLIENT_ERROR,
    });
  }

  if (!hasCredential) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `No server-reachable credentials were found for provider "${provider}".`,
    });
  }

  return payload;
};

export type ConversationRuntimeState = Awaited<
  ReturnType<AiInfraRepos['getAiProviderRuntimeState']>
>;

export const loadConversationRuntimeState = async (db: LobeChatDatabase, userId: string) => {
  const { aiProvider } = await getServerGlobalConfig();
  const aiInfraRepos = new AiInfraRepos(
    db,
    userId,
    aiProvider as Record<string, ProviderConfig>,
  );
  return aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults);
};
