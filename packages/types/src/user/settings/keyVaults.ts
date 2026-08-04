import type { RagProviderConfig } from '../../rag';

export interface OpenAICompatibleKeyVault {
  apiKey?: string;
  baseURL?: string;
}

export interface AnthropicCompatibleKeyVault extends OpenAICompatibleKeyVault {
  authMode?: 'api-key' | 'bearer';
}

export interface AzureOpenAIKeyVault {
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
  /**
   * @deprecated
   */
  endpoint?: string;
}

export interface ComfyUIKeyVault {
  apiKey?: string;
  authType?: 'none' | 'basic' | 'bearer' | 'custom';
  baseURL?: string;
  customHeaders?: Record<string, string>;
  password?: string;
  username?: string;
}

export interface SearchEngineKeyVaults {
  searchxng?: {
    apiKey?: string;
    baseURL?: string;
  };
}

export interface UserKeyVaults extends SearchEngineKeyVaults {
  anthropic?: OpenAICompatibleKeyVault;
  anthropiccompatible?: AnthropicCompatibleKeyVault;
  azure?: AzureOpenAIKeyVault;
  azureai?: AzureOpenAIKeyVault;
  comfyui?: ComfyUIKeyVault;
  google?: OpenAICompatibleKeyVault;
  minimax?: OpenAICompatibleKeyVault;
  moonshot?: OpenAICompatibleKeyVault;
  openai?: OpenAICompatibleKeyVault;
  openaicompatible?: OpenAICompatibleKeyVault;
  password?: string;
  rag?: RagProviderConfig;
}
