import { AiModelForSelect, EnabledAiModel, ModelSearchImplementType } from 'model-bank';
import { z } from 'zod';

export type ResponseAnimationStyle = 'smooth' | 'fadeIn' | 'none';
export type ResponseAnimation =
  | {
      speed?: number;
      text?: ResponseAnimationStyle;
    }
  | ResponseAnimationStyle;

export const AiProviderSourceEnum = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type AiProviderSourceType = (typeof AiProviderSourceEnum)[keyof typeof AiProviderSourceEnum];

/**
 * only when provider use different sdk
 * we will add a type
 */
export const AiProviderSDKEnum = {
  Anthropic: 'anthropic',
  Azure: 'azure',
  AzureAI: 'azureai',
  Bedrock: 'bedrock',
  Cloudflare: 'cloudflare',
  ComfyUI: 'comfyui',
  Google: 'google',
  Huggingface: 'huggingface',
  Ollama: 'ollama',
  Openai: 'openai',
  Qwen: 'qwen',
  Router: 'router',
  Volcengine: 'volcengine',
} as const;

export type AiProviderSDKType = (typeof AiProviderSDKEnum)[keyof typeof AiProviderSDKEnum];

const AiProviderSdkTypes = [
  'anthropic',
  'comfyui',
  'openai',
  'ollama',
  'azure',
  'azureai',
  'bedrock',
  'cloudflare',
  'google',
  'huggingface',
  'router',
  'volcengine',
  'qwen',
] as const satisfies readonly AiProviderSDKType[];

export interface AiProviderSettings {
  /**
   * whether provider show browser request option by default
   *
   * @default false
   */
  defaultShowBrowserRequest?: boolean;
  /**
   * some provider server like stepfun and aliyun don't support browser request,
   * So we should disable it
   *
   * @default false
   */
  disableBrowserRequest?: boolean;
  /**
   * whether provider support edit model
   *
   * @default true
   */
  modelEditable?: boolean;

  proxyUrl?:
    | {
        desc?: string;
        placeholder: string;
        title?: string;
      }
    | false;

  responseAnimation?: ResponseAnimation;
  /**
   * default openai
   */
  sdkType?: AiProviderSDKType;
  searchMode?: ModelSearchImplementType;
  showAddNewModel?: boolean;
  /**
   * whether show api key in the provider config
   * so provider like ollama don't need api key field
   */
  showApiKey?: boolean;
  /**
   * whether show checker in the provider config
   */
  showChecker?: boolean;
  showDeployName?: boolean;
  showModelFetcher?: boolean;
  supportResponsesApi?: boolean;
}

const ResponseAnimationType = z.enum(['smooth', 'fadeIn', 'none']);

const AiProviderSettingsSchema = z.object({
  defaultShowBrowserRequest: z.boolean().optional(),
  disableBrowserRequest: z.boolean().optional(),
  modelEditable: z.boolean().optional(),
  proxyUrl: z
    .object({
      desc: z.string().optional(),
      placeholder: z.string(),
      title: z.string().optional(),
    })
    .or(z.literal(false))
    .optional(),
  responseAnimation: z
    .object({
      text: ResponseAnimationType.optional(),
      toolsCalling: ResponseAnimationType.optional(),
    })
    .or(ResponseAnimationType)
    .optional(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  searchMode: z.enum(['params', 'internal']).optional(),
  showAddNewModel: z.boolean().optional(),
  showApiKey: z.boolean().optional(),
  showChecker: z.boolean().optional(),
  showDeployName: z.boolean().optional(),
  showModelFetcher: z.boolean().optional(),
  supportResponsesApi: z.boolean().optional(),
});

export interface AiProviderConfig {
  enableResponseApi?: boolean;
  openAICompatCache?: OpenAICompatCacheConfig;
  responseStateMode?: 'provider' | 'stateless';
}

export type OpenAICompatCachePreset = 'custom' | 'pptoken.org' | 'apikl.ai';
export type OpenAICompatCachePromptCacheKeyMode = 'off' | 'derived';
export type OpenAICompatCacheStoreMode = 'default' | 'true' | 'false';

export interface OpenAICompatCacheConfig {
  chat?: {
    promptCacheKey?: boolean;
    sessionHeader?: boolean;
  };
  preset?: OpenAICompatCachePreset;
  responses?: {
    promptCacheKey?: OpenAICompatCachePromptCacheKeyMode;
    sessionHeader?: boolean;
    store?: OpenAICompatCacheStoreMode;
  };
}

export const OPENAI_COMPAT_CACHE_PRESETS = ['custom', 'pptoken.org', 'apikl.ai'] as const;

export const defaultOpenAICompatCacheConfig = (): OpenAICompatCacheConfig => ({
  chat: {
    promptCacheKey: false,
    sessionHeader: false,
  },
  preset: 'custom',
  responses: {
    promptCacheKey: 'off',
    sessionHeader: false,
    store: 'default',
  },
});

export const openAICompatCachePresetConfig = (
  preset: OpenAICompatCachePreset,
): OpenAICompatCacheConfig => {
  if (preset === 'pptoken.org') {
    return {
      chat: {
        promptCacheKey: false,
        sessionHeader: false,
      },
      preset,
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'true',
      },
    };
  }

  if (preset === 'apikl.ai') {
    return {
      chat: {
        promptCacheKey: true,
        sessionHeader: true,
      },
      preset,
      responses: {
        promptCacheKey: 'derived',
        sessionHeader: false,
        store: 'default',
      },
    };
  }

  return defaultOpenAICompatCacheConfig();
};

export const normalizeOpenAICompatCacheConfig = (
  config?: AiProviderConfig,
): OpenAICompatCacheConfig => {
  if (!config?.openAICompatCache && config?.responseStateMode === 'provider') {
    return openAICompatCachePresetConfig('pptoken.org');
  }

  const base = defaultOpenAICompatCacheConfig();
  const cache = config?.openAICompatCache || {};
  const preset = cache.preset || base.preset;

  return {
    chat: {
      ...base.chat,
      ...cache.chat,
    },
    preset,
    responses: {
      ...base.responses,
      ...cache.responses,
    },
  };
};

const OpenAICompatCachePresetSchema = z.enum(OPENAI_COMPAT_CACHE_PRESETS);
const OpenAICompatCachePromptCacheKeyModeSchema = z.enum(['off', 'derived']);
const OpenAICompatCacheStoreModeSchema = z.enum(['default', 'true', 'false']);

const OpenAICompatCacheSchema = z.object({
  chat: z
    .object({
      promptCacheKey: z.boolean().optional(),
      sessionHeader: z.boolean().optional(),
    })
    .optional(),
  preset: OpenAICompatCachePresetSchema.optional(),
  responses: z
    .object({
      promptCacheKey: OpenAICompatCachePromptCacheKeyModeSchema.optional(),
      sessionHeader: z.boolean().optional(),
      store: OpenAICompatCacheStoreModeSchema.optional(),
    })
    .optional(),
});

// create
export const CreateAiProviderSchema = z.object({
  config: z.object({}).passthrough().optional(),
  description: z.string().optional(),
  id: z.string(),
  keyVaults: z.any().optional(),
  logo: z.string().optional(),
  name: z.string(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  settings: AiProviderSettingsSchema.optional(),
  source: z.enum(['builtin', 'custom']),
  // checkModel: z.string().optional(),
  // homeUrl: z.string().optional(),
  // modelsUrl: z.string().optional(),
});

export type CreateAiProviderParams = z.infer<typeof CreateAiProviderSchema>;

// List Query

export interface AiProviderListItem {
  description?: string;
  enabled: boolean;
  id: string;
  logo?: string;
  name?: string;
  sort?: number;
  source: AiProviderSourceType;
}

// Detail Query

export interface AiProviderCard {
  /**
   * the default model that used for connection check
   */
  checkModel?: string;
  config: AiProviderSettings;
  description?: string;
  enabled: boolean;
  enabledChatModels: string[];
  /**
   * provider's website url
   */
  homeUrl?: string;
  id: string;
  logo?: string;
  /**
   * the url show the all models in the provider
   */
  modelsUrl?: string;
  /**
   * the name show for end user
   */
  name: string;
}

export interface AiProviderDetailItem {
  /**
   * the default model that used for connection check
   */
  checkModel?: string;
  description?: string;
  enabled: boolean;
  fetchOnClient?: boolean;
  /**
   * provider's website url
   */
  homeUrl?: string;
  id: string;
  keyVaults?: Record<string, any>;
  logo?: string;
  /**
   * the url show the all models in the provider
   */
  modelsUrl?: string;
  /**
   * the name show for end user
   */
  name: string;
  settings: AiProviderSettings;
  source: AiProviderSourceType;
}

// Update
export const UpdateAiProviderSchema = z.object({
  config: z.object({}).passthrough().optional(),
  description: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
  name: z.string(),
  sdkType: z.enum(AiProviderSdkTypes).optional(),
  settings: AiProviderSettingsSchema.optional(),
});

export type UpdateAiProviderParams = z.infer<typeof UpdateAiProviderSchema>;

export const UpdateAiProviderConfigSchema = z.object({
  checkModel: z.string().optional(),
  config: z
    .object({
      enableResponseApi: z.boolean().optional(),
      openAICompatCache: OpenAICompatCacheSchema.optional(),
      responseStateMode: z.enum(['provider', 'stateless']).optional(),
    })
    .optional(),
  fetchOnClient: z.boolean().nullable().optional(),
  keyVaults: z
    .record(
      z.string(),
      z.union([
        z.string().optional(),
        z.record(z.string(), z.string()).optional(), // 支持嵌套对象，如 customHeaders
      ]),
    )
    .optional(),
});

export type UpdateAiProviderConfigParams = z.infer<typeof UpdateAiProviderConfigSchema>;

export interface AiProviderSortMap {
  id: string;
  sort: number;
}

// --------

export interface EnabledProvider {
  id: string;
  logo?: string;
  name?: string;
  source: AiProviderSourceType;
}

export interface EnabledProviderWithModels {
  children: AiModelForSelect[];
  id: string;
  logo?: string;
  name: string;
  source: AiProviderSourceType;
}

export interface AiProviderRuntimeConfig {
  config: AiProviderConfig;
  fetchOnClient?: boolean;
  keyVaults: Record<string, string>;
  settings: AiProviderSettings;
}

export interface AiProviderRuntimeState {
  enabledAiModels: EnabledAiModel[];
  enabledAiProviders: EnabledProvider[];
  enabledChatAiProviders: EnabledProvider[];
  enabledImageAiProviders: EnabledProvider[];
  runtimeConfig: Record<string, AiProviderRuntimeConfig>;
}
