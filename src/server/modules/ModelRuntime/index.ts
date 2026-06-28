import { ModelRuntime } from '@lobechat/model-runtime';
import { ClientSecretPayload } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { getLLMConfig } from '@/envs/llm';

import apiKeyManager from './apiKeyManager';

export * from './trace';

/**
 * Retrieves the options object from environment and apikeymanager
 * based on the provider and payload.
 *
 * @param provider - The model provider.
 * @param payload - The JWT payload.
 * @returns The options object.
 */
const getParamsFromPayload = (provider: string, payload: ClientSecretPayload) => {
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

      const headersStr = process.env['ANTHROPICCOMPATIBLE_DEFAULT_HEADERS']?.trim();
      const defaultHeaders = headersStr
        ? Object.fromEntries(
            headersStr
              .split('\n')
              .map((line) => {
                const idx = line.indexOf(':');
                return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] : null;
              })
              .filter((entry): entry is [string, string] => entry !== null),
          )
        : undefined;

      return {
        apiKey,
        authMode,
        ...(baseURL ? { baseURL } : {}),
        ...(defaultHeaders ? { defaultHeaders } : {}),
      };
    }

    default: {
      const originalUpper = provider.toUpperCase();
      let keyUpper = originalUpper;

      // Some custom provider ids have no `*_API_KEY` in env schema — fall back to OpenAI key material.
      // Proxy URL must stay tied to the **requested** provider; otherwise e.g. Anthropic would inherit
      // `OPENAI_PROXY_URL` / OpenAI-compatible gateways (404 on `/v1/messages`).
      if (!(`${keyUpper}_API_KEY` in llmConfig)) {
        keyUpper = ModelProvider.OpenAI.toUpperCase();
      }

      const apiKey = apiKeyManager.pick(payload?.apiKey || llmConfig[`${keyUpper}_API_KEY`]);
      const baseURL = payload?.baseURL || process.env[`${originalUpper}_PROXY_URL`];

      return baseURL ? { apiKey, baseURL } : { apiKey };
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
    ...getParamsFromPayload(runtimeProvider, payload),
    ...params,
  });
};
