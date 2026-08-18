import { ModelRuntime } from '@lobechat/model-runtime';
import { ClientSecretPayload } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { getLLMConfig } from '@/envs/llm';

import apiKeyManager from './apiKeyManager';

export * from './trace';

const BUILTIN_MODEL_PROVIDERS = new Set<string>(Object.values(ModelProvider));

/**
 * Retrieves the options object from environment and apikeymanager
 * based on the provider and payload.
 *
 * @param provider - The model provider.
 * @param payload - The JWT payload.
 * @returns The options object.
 */
export const getModelRuntimeParamsFromPayload = (
  provider: string,
  payload: ClientSecretPayload,
) => {
  const llmConfig = getLLMConfig() as Record<string, any>;

  switch (provider) {
    case ModelProvider.Azure: {
      const { AZURE_API_KEY, AZURE_API_VERSION, AZURE_ENDPOINT } = llmConfig;
      const apiKey = apiKeyManager.pick(payload?.apiKey || AZURE_API_KEY);
      const baseURL = payload?.baseURL || AZURE_ENDPOINT;
      const apiVersion = payload?.azureApiVersion || AZURE_API_VERSION;
      return { apiKey, apiVersion, baseURL };
    }

    case ModelProvider.AzureAI: {
      const { AZUREAI_ENDPOINT, AZUREAI_ENDPOINT_KEY } = llmConfig;
      const apiKey = payload?.apiKey || AZUREAI_ENDPOINT_KEY;
      const baseURL = payload?.baseURL || AZUREAI_ENDPOINT;
      return { apiKey, baseURL };
    }

    case ModelProvider.AnthropicCompatible: {
      const apiKey = apiKeyManager.pick(
        payload?.apiKey || llmConfig['ANTHROPICCOMPATIBLE_API_KEY'],
      );
      const baseURL = payload?.baseURL || process.env['ANTHROPICCOMPATIBLE_PROXY_URL'];
      const authMode =
        payload?.authType || llmConfig['ANTHROPICCOMPATIBLE_AUTH_MODE'] || 'api-key';

      return { apiKey, authMode, ...(baseURL ? { baseURL } : {}) };
    }

    default: {
      const originalUpper = provider.toUpperCase();
      const keyUpper = BUILTIN_MODEL_PROVIDERS.has(provider)
        ? originalUpper
        : ModelProvider.OpenAI.toUpperCase();

      const apiKey = apiKeyManager.pick(payload?.apiKey || llmConfig[`${keyUpper}_API_KEY`]);
      const baseURL =
        payload?.baseURL ||
        llmConfig[`${originalUpper}_PROXY_URL`] ||
        process.env[`${originalUpper}_PROXY_URL`];
      const accessKeyId =
        payload?.awsAccessKeyId || (payload as { accessKeyId?: string }).accessKeyId;
      const accessKeySecret =
        payload?.awsSecretAccessKey || (payload as { accessKeySecret?: string }).accessKeySecret;
      const region = payload?.awsRegion || (payload as { region?: string }).region;
      const sessionToken =
        payload?.awsSessionToken || (payload as { sessionToken?: string }).sessionToken;

      return {
        ...(baseURL ? { apiKey, baseURL } : { apiKey }),
        ...(accessKeyId || accessKeySecret || region
          ? { accessKeyId, accessKeySecret, region, sessionToken }
          : {}),
        ...(payload?.cloudflareBaseURLOrAccountID
          ? { baseURLOrAccountID: payload.cloudflareBaseURLOrAccountID }
          : {}),
      };
    }
  }
};

/**
 * Initializes the agent runtime with the user payload in backend
 * @param provider - The provider name.
 * @param payload - The JWT payload.
 * @param params
 * @returns A promise that resolves when the agent runtime is initialized.
 */
export const initModelRuntimeWithUserPayload = (
  provider: string,
  payload: ClientSecretPayload,
  params: any = {},
) => {
  const runtimeProvider = payload.runtimeProvider ?? provider;

  return ModelRuntime.initializeWithProvider(runtimeProvider, {
    ...getModelRuntimeParamsFromPayload(runtimeProvider, payload),
    ...params,
  });
};
