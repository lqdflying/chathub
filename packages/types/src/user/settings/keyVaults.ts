export interface OpenAICompatibleKeyVault {
  apiKey?: string;
  baseURL?: string;
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
  anthropiccompatible?: OpenAICompatibleKeyVault;
  azure?: AzureOpenAIKeyVault;
  azureai?: AzureOpenAIKeyVault;
  comfyui?: ComfyUIKeyVault;
  google?: OpenAICompatibleKeyVault;
  minimax?: OpenAICompatibleKeyVault;
  moonshot?: OpenAICompatibleKeyVault;
  openai?: OpenAICompatibleKeyVault;
  openaicompatible?: OpenAICompatibleKeyVault;
  password?: string;
}
