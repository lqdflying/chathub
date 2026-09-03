import { ModelProvider } from 'model-bank';

import { isDisableStreamModel, isResponsesAPIOnlyModel } from '../../const/models';
import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface OpenAIModelCard {
  id: string;
}

const prunePrefixes = ['o1', 'o3', 'o4', 'codex', 'computer-use', 'gpt-5'];
const oaiSearchContextSize = process.env.OPENAI_SEARCH_CONTEXT_SIZE; // low, medium, high
const enableServiceTierFlex = process.env.OPENAI_SERVICE_TIER_FLEX === '1';
const flexSupportedModels = ['gpt-5', 'o3', 'o4-mini']; // Flex 处理仅适用于这些模型

const supportsFlexTier = (model: string) => {
  // 排除 o3-mini，其不支持 Flex 处理
  if (model.startsWith('o3-mini')) {
    return false;
  }
  return flexSupportedModels.some((supportedModel) => model.startsWith(supportedModel));
};

export const params = {
  baseURL: 'https://api.openai.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        apiMode: _apiMode,
        enabledSearch,
        enabledContextCaching: _enabledContextCaching,
        frequency_penalty: _frequencyPenalty,
        model,
        openAICompatCache: _openAICompatCache,
        openAICompatResponsesParams: _openAICompatResponsesParams,
        presence_penalty: _presencePenalty,
        provider: _provider,
        reasoning_split: _reasoningSplit,
        responseMode: _responseMode,
        responseStateMode: _responseStateMode,
        temperature: _temperature,
        thinkingBudget: _thinkingBudget,
        top_p: _topP,
        urlContext: _urlContext,
        ...rest
      } = payload;

      if (isResponsesAPIOnlyModel(model) || enabledSearch) {
        return {
          ...rest,
          apiMode: 'responses',
          enabledSearch,
          model,
          ...(isDisableStreamModel(model) ? { stream: false } : {}),
        } as ChatStreamPayload;
      }

      if (prunePrefixes.some((prefix) => model.startsWith(prefix))) {
        return pruneReasoningPayload({ ...rest, model } as ChatStreamPayload) as any;
      }

      if (model.includes('-search-')) {
        return {
          ...rest,
          model,
          stream: payload.stream ?? true,
          ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
          ...(oaiSearchContextSize && {
            web_search_options: {
              search_context_size: oaiSearchContextSize,
            },
          }),
        } as any;
      }

      return {
        ...rest,
        model,
        ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
        stream: payload.stream ?? true,
      };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENAI_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: OpenAIModelCard[] = modelsPage.data;

    // 自动检测模型提供商并选择相应配置
    return processMultiProviderModelList(modelList, 'openai');
  },
  provider: ModelProvider.OpenAI,
  responses: {
    handlePayload: (payload) => {
      const {
        apiMode: _apiMode,
        enabledSearch,
        enabledContextCaching: _enabledContextCaching,
        frequency_penalty: _frequencyPenalty,
        model,
        openAICompatCache: _openAICompatCache,
        openAICompatResponsesParams: _openAICompatResponsesParams,
        presence_penalty: _presencePenalty,
        provider: _provider,
        reasoning_split: _reasoningSplit,
        responseMode: _responseMode,
        responseStateMode: _responseStateMode,
        temperature: _temperature,
        thinkingBudget: _thinkingBudget,
        tools,
        top_p: _topP,
        urlContext: _urlContext,
        verbosity,
        ...rest
      } = payload;

      const openaiTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              ...(oaiSearchContextSize && {
                search_context_size: oaiSearchContextSize,
              }),
            },
          ]
        : tools;

      if (prunePrefixes.some((prefix) => model.startsWith(prefix))) {
        const reasoning = payload.reasoning
          ? { ...payload.reasoning, summary: 'auto' }
          : { summary: 'auto' };
        if (model.startsWith('gpt-5-pro')) {
          reasoning.effort = 'high';
        }
        return pruneReasoningPayload({
          ...rest,
          model,
          reasoning,
          ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
          stream: payload.stream ?? true,
          tools: openaiTools as any,
          // computer-use series must set truncation as auto
          ...(model.startsWith('computer-use') && { truncation: 'auto' }),
          text: verbosity ? { verbosity } : undefined,
        }) as any;
      }

      return {
        ...rest,
        model,
        ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
        stream: payload.stream ?? true,
        tools: openaiTools,
      } as any;
    },
  },
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenAI = createOpenAICompatibleRuntime(params);
