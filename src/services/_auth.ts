import { LOBE_CHAT_AUTH_HEADER, isDeprecatedEdition } from '@lobechat/const';
import {
  AnthropicCompatibleKeyVault,
  AzureOpenAIKeyVault,
  ClientSecretPayload,
  OpenAICompatibleKeyVault,
} from '@lobechat/types';
import { clientApiKeyManager } from '@lobechat/utils/client';
import { ModelProvider } from 'model-bank';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import {
  authSelectors,
  keyVaultsConfigSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import { obfuscatePayloadWithXOR } from '@/utils/client/xor-obfuscation';

import { resolveRuntimeProvider } from './chat/helper';

export const getProviderAuthPayload = (
  provider: string,
  keyVaults: OpenAICompatibleKeyVault & AzureOpenAIKeyVault,
) => {
  switch (provider) {
    case ModelProvider.Azure: {
      return {
        apiKey: clientApiKeyManager.pick(keyVaults.apiKey),
        apiVersion: keyVaults.apiVersion,
        /** @deprecated */
        azureApiVersion: keyVaults.apiVersion,
        baseURL: keyVaults.baseURL || keyVaults.endpoint,
      };
    }

    case ModelProvider.AnthropicCompatible: {
      const vault = keyVaults as unknown as AnthropicCompatibleKeyVault;
      return {
        apiKey: clientApiKeyManager.pick(vault?.apiKey),
        authType: vault?.authMode,
        baseURL: vault?.baseURL,
      };
    }

    default: {
      return { apiKey: clientApiKeyManager.pick(keyVaults?.apiKey), baseURL: keyVaults?.baseURL };
    }
  }
};

const createAuthTokenWithPayload = (payload = {}) => {
  const accessCode = keyVaultsConfigSelectors.password(useUserStore.getState());
  const userId = userProfileSelectors.userId(useUserStore.getState());

  return obfuscatePayloadWithXOR<ClientSecretPayload>({ accessCode, userId, ...payload });
};

interface AuthParams {
  // eslint-disable-next-line no-undef
  headers?: HeadersInit;
  payload?: Record<string, any>;
  provider?: string;
}

const assertActiveUserStateOwnership = (): void => {
  if (authSelectors.hasActiveUserStateOwnerMismatch(useUserStore.getState())) {
    throw new TypeError('user state ownership is not initialized');
  }
};

export const createPayloadWithKeyVaults = (provider: string) => {
  assertActiveUserStateOwnership();
  let keyVaults = {};

  // TODO: remove this condition in V2.0
  if (isDeprecatedEdition) {
    keyVaults = keyVaultsConfigSelectors.getVaultByProvider(provider as any)(
      useUserStore.getState(),
    );
  } else {
    const userState = useUserStore.getState();
    const runtimeState = useAiInfraStore.getState();
    const expectedRuntimeScope = authSelectors.currentUserScope(userState);
    const isCurrentRuntimeReady =
      !!expectedRuntimeScope &&
      runtimeState.runtimeStateRequestScope === expectedRuntimeScope &&
      runtimeState.runtimeStateScope === expectedRuntimeScope;

    keyVaults = isCurrentRuntimeReady
      ? aiProviderSelectors.providerKeyVaults(provider)(runtimeState) || {}
      : {};
  }

  const runtimeProvider = resolveRuntimeProvider(provider);

  return {
    ...getProviderAuthPayload(runtimeProvider, keyVaults as any),
    runtimeProvider,
  };
};

export const createXorKeyVaultsPayload = (provider: string) => {
  const payload = createPayloadWithKeyVaults(provider);
  return obfuscatePayloadWithXOR(payload);
};

// eslint-disable-next-line no-undef
export const createHeaderWithAuth = async (params?: AuthParams): Promise<HeadersInit> => {
  assertActiveUserStateOwnership();
  let payload = params?.payload || {};

  if (params?.provider) {
    payload = { ...payload, ...createPayloadWithKeyVaults(params?.provider) };
  }

  const token = createAuthTokenWithPayload(payload);

  // eslint-disable-next-line no-undef
  return { ...params?.headers, [LOBE_CHAT_AUTH_HEADER]: token };
};
