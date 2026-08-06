import { isEmpty } from 'lodash-es';
import {
  AIChatModelCard,
  AiModelSourceEnum,
  AiProviderModelListItem,
  EnabledAiModel,
  ModelProvider,
  OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
  type ExtendParamsType,
} from 'model-bank';
import pMap from 'p-map';

import { DEFAULT_MODEL_PROVIDER_LIST } from '@/config/modelProviders';
import {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
  EnabledProvider,
} from '@/types/aiProvider';
import { ProviderConfig } from '@/types/user/settings';
import { merge, mergeArrayById } from '@/utils/merge';

import { AiModelModel } from '../../models/aiModel';
import { AiProviderModel } from '../../models/aiProvider';
import { LobeChatDatabase } from '../../type';

type DecryptUserKeyVaults = (encryptKeyVaultsStr: string | null) => Promise<any>;

/**
 * Provider 级默认表（只在本地内置模型没给出 settings.searchImpl 和 settings.searchProvider 时使用）
 * 注意：不在 DB 存储，纯读取时注入
 */
const PROVIDER_SEARCH_DEFAULTS: Record<
  string,
  { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string }
> = {
  ai360: { searchImpl: 'params' },
  aihubmix: { searchImpl: 'params' },
  anthropic: { searchImpl: 'params' },
  baichuan: { searchImpl: 'params' },
  default: { searchImpl: 'params' },
  google: { searchImpl: 'params', searchProvider: 'google' },
  hunyuan: { searchImpl: 'params' },
  jina: { searchImpl: 'internal' },
  minimax: { searchImpl: 'params' },
  // openai: 默认 params，但对 -search- 型号做 internal 特判
  openai: { searchImpl: 'params' },
  // perplexity: 默认 internal
  perplexity: { searchImpl: 'internal' },
  qwen: { searchImpl: 'params' },
  spark: { searchImpl: 'params' }, // 某些模型（如 max-32k）若内置标了 internal，会优先使用内置
  stepfun: { searchImpl: 'params' },
  vertexai: { searchImpl: 'params', searchProvider: 'google' },
  wenxin: { searchImpl: 'params' },
  xai: { searchImpl: 'params' },
  zhipu: { searchImpl: 'params' },
};

const FIXED_MODEL_LIST_PROVIDERS = new Set<string>([
  ModelProvider.AnthropicCompatible,
  ModelProvider.OpenAICompatible,
]);

// 特殊模型配置 - 模型级别的特殊设置会覆盖服务商默认配置
const MODEL_SEARCH_DEFAULTS: Record<
  string,
  Record<string, { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string }>
> = {
  openai: {
    'gpt-4o-mini-search-preview': { searchImpl: 'internal' },
    'gpt-4o-search-preview': { searchImpl: 'internal' },
    // 可在此处添加其他特殊模型配置
  },
  spark: {
    'max-32k': { searchImpl: 'internal' },
  },
  // 可在此处添加其他服务商的特殊模型配置
};

// 根据 providerId + modelId 推断默认 settings
const inferProviderSearchDefaults = (
  providerId: string | undefined,
  modelId: string,
): { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string } => {
  const modelSpecificConfig = providerId ? MODEL_SEARCH_DEFAULTS[providerId]?.[modelId] : undefined;
  if (modelSpecificConfig) {
    return modelSpecificConfig;
  }

  return (providerId && PROVIDER_SEARCH_DEFAULTS[providerId]) || PROVIDER_SEARCH_DEFAULTS.default;
};

const inferProviderExtendParams = (
  providerId: string,
  item: { abilities?: { reasoning?: boolean }; id: string },
): ExtendParamsType[] | undefined => {
  const modelId = item.id.toLowerCase();

  if (providerId === ModelProvider.DeepSeek) {
    if (
      modelId.includes('deepseek-v4') ||
      modelId.includes('deepseek-reasoner') ||
      item.abilities?.reasoning
    ) {
      return ['enableReasoning', 'reasoningEffort'];
    }
  }

  if (providerId === ModelProvider.Minimax) {
    if (modelId.includes('minimax-m') || item.abilities?.reasoning) {
      return ['minimaxReasoningSplit'];
    }
  }

  if (providerId === ModelProvider.Moonshot) {
    if (modelId === 'kimi-k2.5') return ['enableReasoning'];
    if (modelId === 'kimi-k2.6') return ['enableReasoning', 'moonshotPreservedReasoning'];
  }

  // Zhipu (GLM) intentionally infers NO reasoning extendParams: ChatHub omits the
  // `thinking`/`reasoning_effort`/`clear_thinking` request fields (official default
  // is thinking enabled; some GLM gateways reject the `thinking` object), so there
  // is no thinking/effort/preserved-thinking toggle to surface for fetched models.

  return undefined;
};

// Only inject non-persistent option-panel settings for providers whose fetched
// model cards cannot carry model-bank settings through the remote model table.
const injectExtendParamSettings = (providerId: string, item: any) => {
  if (item?.settings?.extendParams?.length) return item;

  const extendParams = inferProviderExtendParams(providerId, item);
  if (!extendParams?.length) return item;

  return {
    ...item,
    settings: {
      ...item.settings,
      extendParams,
    },
  };
};

// 仅在读取时注入 settings; 根据 abilities.search 来添加或删去settings 中的 search 相关字段
const injectSearchSettings = (providerId: string, item: any) => {
  const abilities = item?.abilities || {};

  // 模型显式关闭搜索能力：移除 settings 中的 search 相关字段，确保 UI 不显示启用模型内置搜索
  if (abilities.search === false) {
    if (item?.settings?.searchImpl || item?.settings?.searchProvider) {
      const next = { ...item } as any;
      if (next.settings) {
        const { searchImpl, searchProvider, ...restSettings } = next.settings;
        next.settings = Object.keys(restSettings).length > 0 ? restSettings : undefined;
      }
      return next;
    }
    return item;
  }

  // 模型显式开启搜索能力：添加 settings 中的 search 相关字段
  else if (abilities.search === true) {
    // 内置（本地）模型如果已经带了任一字段，直接保留，不覆盖
    if (item?.settings?.searchImpl || item?.settings?.searchProvider) return item;

    // 否则按 providerId + modelId
    const searchSettings = inferProviderSearchDefaults(providerId, item.id);

    return {
      ...item,
      settings: {
        ...item.settings,
        ...searchSettings,
      },
    };
  }

  // 兼容老版本中数据库没有存储 abilities.search 字段的情况
  return item;
};

const enforceOpenAICompatibleContextWindow = (providerId: string, item: any) => {
  if (providerId !== ModelProvider.OpenAICompatible || item?.type !== 'chat') return item;

  return {
    ...item,
    contextWindowTokens: OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
  };
};

export const injectModelSettings = (providerId: string, item: any) =>
  enforceOpenAICompatibleContextWindow(
    providerId,
    injectSearchSettings(providerId, injectExtendParamSettings(providerId, item)),
  );

export class AiInfraRepos {
  private userId: string;
  private db: LobeChatDatabase;
  aiProviderModel: AiProviderModel;
  private readonly providerConfigs: Record<string, ProviderConfig>;
  aiModelModel: AiModelModel;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    providerConfigs: Record<string, ProviderConfig>,
  ) {
    this.userId = userId;
    this.db = db;
    this.aiProviderModel = new AiProviderModel(db, userId);
    this.aiModelModel = new AiModelModel(db, userId);
    this.providerConfigs = providerConfigs;
  }

  /**
   * Calculate the final providerList based on the known providerConfig
   */
  getAiProviderList = async () => {
    const userProviders = await this.aiProviderModel.getAiProviderList();

    // 1. 先创建一个基于 DEFAULT_MODEL_PROVIDER_LIST id 顺序的映射
    const orderMap = new Map(DEFAULT_MODEL_PROVIDER_LIST.map((item, index) => [item.id, index]));

    const builtinProviders = DEFAULT_MODEL_PROVIDER_LIST.map((item) => ({
      description: item.description,
      enabled:
        userProviders.some((provider) => provider.id === item.id && provider.enabled) ||
        this.providerConfigs[item.id]?.enabled,
      id: item.id,
      name: item.name,
      source: 'builtin',
    })) as AiProviderListItem[];

    // Only keep user DB entries that are still in the current builtin list, or are custom providers.
    // This prevents old removed builtin providers from reappearing after a version upgrade.
    const filteredUserProviders = userProviders.filter(
      (p) => p.source === 'custom' || orderMap.has(p.id),
    );

    const mergedProviders = mergeArrayById(builtinProviders, filteredUserProviders);

    // 3. 根据 orderMap 排序
    return mergedProviders.sort((a, b) => {
      const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  };

  /**
   * used in the chat page. to show the enabled providers
   */
  getUserEnabledProviderList = async () => {
    const list = await this.getAiProviderList();
    return list
      .filter((item) => item.enabled)
      .sort((a, b) => a.sort! - b.sort!)
      .map(
        (item): EnabledProvider => ({
          id: item.id,
          logo: item.logo,
          name: item.name,
          source: item.source,
        }),
      );
  };

  /**
   * used in the chat page. to show the enabled models
   */
  getEnabledModels = async (filterEnabled: boolean = true) => {
    const [providers, allModels] = await Promise.all([
      this.getAiProviderList(),
      this.aiModelModel.getAllModels(),
    ]);
    const enabledProviders = providers.filter((item) => (filterEnabled ? item.enabled : true));

    const builtinModelList = await pMap(
      enabledProviders,
      async (provider) => {
        const aiModels = await this.fetchBuiltinModels(provider.id);
        return (aiModels || [])
          .map<EnabledAiModel & { enabled?: boolean | null }>((item) => {
            const user = allModels.find((m) => m.id === item.id && m.providerId === provider.id);

            // 用户未修改本地模型
            if (!user)
              return {
                ...item,
                abilities: item.abilities || {},
                providerId: provider.id,
              };

            const mergedModel = {
              ...item,
              abilities: merge(item.abilities || {}, !isEmpty(user.abilities) ? user.abilities : {}),
              config: !isEmpty(user.config) ? user.config : item.config,
              contextWindowTokens:
                typeof user.contextWindowTokens === 'number'
                  ? user.contextWindowTokens
                  : item.contextWindowTokens,
              displayName: user?.displayName || item.displayName,
              enabled: typeof user.enabled === 'boolean' ? user.enabled : item.enabled,
              id: item.id,
              providerId: provider.id,
              settings: item.settings,
              sort: user.sort || undefined,
              type: user.type || item.type,
            };
            return injectModelSettings(provider.id, mergedModel); // 用户修改本地模型，检查搜索设置
          })
          .filter((item) => (filterEnabled ? item.enabled : true));
      },
      { concurrency: 10 },
    );

    const enabledProviderIds = new Set(enabledProviders.map((item) => item.id));
    // 用户数据库模型，检查搜索设置
    const appendedUserModels = allModels
      .filter((item) =>
        filterEnabled
          ? enabledProviderIds.has(item.providerId) &&
            item.enabled &&
            !FIXED_MODEL_LIST_PROVIDERS.has(item.providerId)
          : !FIXED_MODEL_LIST_PROVIDERS.has(item.providerId),
      )
      .map((item) => injectModelSettings(item.providerId, item));

    return [...builtinModelList.flat(), ...appendedUserModels].sort(
      (a, b) => (a?.sort || -1) - (b?.sort || -1),
    ) as EnabledAiModel[];
  };

  getAiProviderRuntimeState = async (
    decryptor?: DecryptUserKeyVaults,
  ): Promise<AiProviderRuntimeState> => {
    const [result, enabledAiProviders, allModels] = await Promise.all([
      this.aiProviderModel.getAiProviderRuntimeConfig(decryptor),
      this.getUserEnabledProviderList(),
      this.getEnabledModels(false),
    ]);

    const runtimeConfig = result;
    Object.entries(result).forEach(([key, value]) => {
      runtimeConfig[key] = merge(this.providerConfigs[key] || {}, value);
    });
    const enabledAiModels = allModels.filter((model) => model.enabled);
    const enabledChatAiProviders = enabledAiProviders.filter((provider) => {
      return allModels.some((model) => model.providerId === provider.id && model.type === 'chat');
    });
    const enabledImageAiProviders = enabledAiProviders.filter((provider) => {
      return allModels.some((model) => model.providerId === provider.id && model.type === 'image');
    });

    return {
      enabledAiModels,
      enabledAiProviders,
      enabledChatAiProviders,
      enabledImageAiProviders,
      runtimeConfig,
    };
  };

  getAiProviderModelList = async (providerId: string) => {
    const aiModels = await this.aiModelModel.getModelListByProviderId(providerId);

    const defaultModels: AiProviderModelListItem[] =
      (await this.fetchBuiltinModels(providerId)) || [];
    const fixedModelIds = new Set(defaultModels.map((model) => model.id));
    const userModels = FIXED_MODEL_LIST_PROVIDERS.has(providerId)
      ? aiModels.filter((model) => fixedModelIds.has(model.id))
      : aiModels;
    // 这里不修改搜索设置不影响使用，但是为了get数据统一
    const mergedModel = mergeArrayById(defaultModels, userModels) as AiProviderModelListItem[];

    return mergedModel.map((m) => injectModelSettings(providerId, m));
  };

  /**
   * use in the `/settings?active=provider&provider=[id]` page
   */
  getAiProviderDetail = async (id: string, decryptor?: DecryptUserKeyVaults) => {
    const config = await this.aiProviderModel.getAiProviderById(id, decryptor);

    return merge(this.providerConfigs[id] || {}, config) as AiProviderDetailItem;
  };

  /**
   * Fetch builtin models from config
   */
  private fetchBuiltinModels = async (
    providerId: string,
  ): Promise<AiProviderModelListItem[] | undefined> => {
    try {
      const modules = await import('model-bank');

      // TODO: when model-bank is a separate module, we will try import from model-bank/[prividerId] again
      // @ts-expect-error providerId is string
      const providerModels = modules[providerId];

      // use the serverModelLists as the defined server model list
      // fallback to empty array for custom provider
      const presetList = this.providerConfigs[providerId]?.serverModelLists || providerModels || [];

      return (presetList as AIChatModelCard[]).map<AiProviderModelListItem>((m) => ({
        ...m,
        enabled: m.enabled || false,
        source: AiModelSourceEnum.Builtin,
      }));
    } catch (error) {
      console.error(error);
      // maybe provider id not exist
    }
  };
}
