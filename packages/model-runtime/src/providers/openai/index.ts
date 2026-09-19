import { ModelProvider } from 'model-bank';

import { isDisableStreamModel, isResponsesAPIOnlyModel } from '../../const/models';
import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { CreateImagePayload } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { processMultiProviderModelList } from '../../utils/modelParse';
import {
  OPENAI_CODEX_AUTH_MODE,
} from './codexConstants';
import { fetchOpenAICodexModels } from './codexModels';
import { chatWithCodexResponses } from './codexResponses';

export interface OpenAIModelCard {
  id: string;
}

const prunePrefixes = ['o1', 'o3', 'o4', 'codex', 'computer-use', 'gpt-5', 'gpt-6'];
const oaiSearchContextSize = process.env.OPENAI_SEARCH_CONTEXT_SIZE; // low, medium, high
const enableServiceTierFlex = process.env.OPENAI_SERVICE_TIER_FLEX === '1';
const flexSupportedModels = ['gpt-5', 'o3', 'o4-mini']; // Flex 处理仅适用于这些模型

/** Official GPT-6 Astra plus dated snapshots (`gpt-6-astra-…`). */
export const GPT6_ASTRA_MODEL_PATTERN = /^gpt-6-astra(?:-|$)/;

export const isGpt6AstraModel = (model: string): boolean => GPT6_ASTRA_MODEL_PATTERN.test(model);

/**
 * Fresh function/MCP tools or a replay that already contains tool calls/results.
 * Official OpenAI: Astra supports Chat Completions, but tool calling requires Responses.
 * https://developers.openai.com/api/docs/guides/latest-model
 */
export const hasOpenAIToolCallingTurn = (payload: ChatStreamPayload): boolean => {
  if (Array.isArray(payload.tools) && payload.tools.length > 0) return true;

  return (payload.messages ?? []).some((message) => {
    if (message.role === 'tool' || message.role === 'function') return true;
    if (message.function_call) return true;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  });
};

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

      if (
        isResponsesAPIOnlyModel(model) ||
        enabledSearch ||
        (isGpt6AstraModel(model) && hasOpenAIToolCallingTurn(payload))
      ) {
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
  // Structured tool selection (group supervisor, tRPC generateObject) bypasses
  // chatCompletion.handlePayload. Official Astra tool calling requires Responses.
  generateObject: {
    useResponseModels: [GPT6_ASTRA_MODEL_PATTERN],
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

const LobeOpenAIPlatform = createOpenAICompatibleRuntime(params);

export class LobeOpenAI extends LobeOpenAIPlatform {
  private readonly accountId?: string;
  private readonly authMode?: string;

  constructor(options: Record<string, any> = {}) {
    super(options);
    this.accountId = typeof options.accountId === 'string' ? options.accountId : undefined;
    this.authMode = typeof options.authMode === 'string' ? options.authMode : undefined;
  }

  private isCodexOAuth() {
    return this.authMode === OPENAI_CODEX_AUTH_MODE;
  }

  private requireCodexAccountId() {
    if (this.accountId) return this.accountId;
    throw AgentRuntimeError.createError('InvalidProviderAPIKey', {
      message: 'Codex subscription is missing chatgpt-account-id.',
    });
  }

  private requireCodexAccessToken() {
    const accessToken = this.client.apiKey;
    if (accessToken) return accessToken;
    throw AgentRuntimeError.createError('InvalidProviderAPIKey', {
      message: 'Codex subscription is missing an access token.',
    });
  }

  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    if (!this.isCodexOAuth()) return super.chat(payload, options);

    return chatWithCodexResponses({
      accessToken: this.requireCodexAccessToken(),
      accountId: this.requireCodexAccountId(),
      options,
      payload,
    });
  }

  override async models() {
    if (!this.isCodexOAuth()) return super.models();

    return fetchOpenAICodexModels({
      accessToken: this.requireCodexAccessToken(),
      accountId: this.requireCodexAccountId(),
    });
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    if (!this.isCodexOAuth()) return super.generateObject(payload, options);

    throw AgentRuntimeError.createError('ProviderBizError', {
      message: 'ChatGPT / Codex subscription is chat-only and does not support structured object generation.',
    });
  }

  override async createImage(payload: CreateImagePayload) {
    if (!this.isCodexOAuth()) return super.createImage(payload);

    throw AgentRuntimeError.createError('ProviderBizError', {
      message: 'ChatGPT / Codex subscription is chat-only. Use an OpenAI API key for images.',
    });
  }
}

export {
  OPENAI_AUTH_BASE_URL,
  OPENAI_CODEX_AUTH_MODE,
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_CLIENT_VERSION,
  OPENAI_CODEX_DEVICE_CALLBACK_URL,
  OPENAI_CODEX_DEVICE_TIMEOUT_MS,
  OPENAI_CODEX_DEVICE_VERIFICATION_URL,
  OPENAI_CODEX_HANDOFF_CLIENT,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_REFRESH_SKEW_MS,
  OPENAI_CODEX_USER_AGENT,
} from './codexConstants';
export {
  classifyCodexMediaType,
  classifyCodexStreamSettled,
  describeOpenAICodexErrorClass,
  isOpenAICodexDebugEnabled,
  logOpenAICodexDebugSafe,
  OPENAI_CODEX_DEBUG_NAMESPACE,
} from './codexDebug';
