import { resolveXaiReasoningEffort } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload, GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import type { CreateImagePayload } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import {
  XAI_API_BASE_URL,
  XAI_OAUTH_AUTH_MODE,
  XAI_OAUTH_CLIENT_HEADERS,
} from './constants';

export {
  XAI_API_BASE_URL,
  XAI_DEVICE_CODE_DEFAULT_INTERVAL_MS,
  XAI_DEVICE_CODE_GRANT_TYPE,
  XAI_DEVICE_CODE_MIN_INTERVAL_MS,
  XAI_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS,
  XAI_OAUTH_AUTH_MODE,
  XAI_OAUTH_BASE_URL,
  XAI_OAUTH_BILLING_URL,
  XAI_OAUTH_CLIENT_HEADERS,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_CLIENT_MODE,
  XAI_OAUTH_CLIENT_VERSION,
  XAI_OAUTH_DEVICE_TIMEOUT_MS,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_HANDOFF_CLIENT,
  XAI_OAUTH_ISSUER,
  XAI_OAUTH_LEGACY_TOKEN_ENDPOINT,
  XAI_OAUTH_REFRESH_SKEW_MS,
  XAI_OAUTH_REFRESH_TIMEOUT_MS,
  XAI_OAUTH_SCOPE,
  XAI_OAUTH_USAGE_TIMEOUT_MS,
  XAI_OAUTH_USER_AGENT,
  isTrustedXaiOAuthHost,
} from './constants';
export {
  describeXaiOAuthErrorClass,
  isXaiOAuthDebugEnabled,
  logXaiOAuthDebugSafe,
  XAI_OAUTH_DEBUG_NAMESPACE,
} from './debug';

const XAI_WEB_SEARCH_TOOL = { type: 'web_search' } as const;

const isXaiReasoningRequest = (model: string, effort?: string) => {
  const id = model.toLowerCase();
  if (id.includes('non-reasoning')) return false;
  if (id.includes('grok-4.3')) return effort !== 'none';
  return (
    id.includes('grok-4.6') ||
    id.includes('grok-4.5') ||
    id.includes('grok-4.20') ||
    id.includes('grok-build') ||
    Boolean(effort && effort !== 'none')
  );
};

export const buildXaiPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const {
    apiMode,
    enabledSearch,
    frequency_penalty,
    model,
    openAICompatCache: _openAICompatCache,
    openAICompatResponsesParams: _openAICompatResponsesParams,
    presence_penalty,
    provider: _provider,
    reasoning_effort: requestedEffort,
    reasoning_split: _reasoningSplit,
    responseMode: _responseMode,
    responseStateMode: _responseStateMode,
    temperature,
    thinkingBudget: _thinkingBudget,
    top_p,
    urlContext: _urlContext,
    ...rest
  } = payload;

  const resolution = resolveXaiReasoningEffort(model, requestedEffort as any);
  const effort = resolution.effort;
  const thinkingOn = isXaiReasoningRequest(model, effort);
  const { stop, ...restWithoutStop } = rest as typeof rest & { stop?: unknown };
  const tools = [...((restWithoutStop.tools as any[]) ?? [])];

  if (enabledSearch && apiMode === 'responses') {
    const alreadyHasSearch = tools.some((tool) => tool?.type === 'web_search');
    if (!alreadyHasSearch) tools.push(XAI_WEB_SEARCH_TOOL);
  }

  return {
    ...restWithoutStop,
    ...(apiMode ? { apiMode } : {}),
    model,
    ...(thinkingOn
      ? {}
      : {
          ...(frequency_penalty === undefined ? {} : { frequency_penalty }),
          ...(presence_penalty === undefined ? {} : { presence_penalty }),
          ...(stop === undefined ? {} : { stop }),
          ...(temperature === undefined ? {} : { temperature }),
          ...(top_p === undefined ? {} : { top_p }),
        }),
    ...(effort && effort !== 'none' ? { reasoning_effort: effort } : {}),
    stream: payload.stream ?? true,
    ...(tools.length > 0 ? { tools } : {}),
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchXaiModels = async ({ client }: { client: OpenAI }): Promise<any[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: Array<{ id: string }> = modelsPage.data || [];

    return processModelList(
      modelList.map((model) => ({ id: model.id })),
      MODEL_LIST_CONFIGS.xai,
      ModelProvider.Xai,
    );
  } catch (error) {
    console.warn('Failed to fetch xAI models:', error);
    return [];
  }
};

const LobeXaiPlatform = createOpenAICompatibleRuntime({
  baseURL: XAI_API_BASE_URL,
  cacheSupport: 'supported',
  chatCompletion: {
    handlePayload: buildXaiPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_XAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_XAI_RESPONSES === '1',
  },
  models: fetchXaiModels,
  provider: ModelProvider.Xai,
});

export class LobeXaiAI extends LobeXaiPlatform {
  private readonly authMode?: string;

  constructor(options: Record<string, any> = {}) {
    const authMode = typeof options.authMode === 'string' ? options.authMode : undefined;
    super({
      ...options,
      defaultHeaders: {
        ...(authMode === XAI_OAUTH_AUTH_MODE ? XAI_OAUTH_CLIENT_HEADERS : {}),
        ...options.defaultHeaders,
      },
    });
    this.authMode = authMode;
  }

  private isXaiOAuth() {
    return this.authMode === XAI_OAUTH_AUTH_MODE;
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    if (!this.isXaiOAuth()) return super.generateObject(payload, options);

    throw AgentRuntimeError.createError('ProviderBizError', {
      message: 'SuperGrok OAuth is chat-only and does not support structured object generation.',
    });
  }

  override async createImage(payload: CreateImagePayload) {
    if (!this.isXaiOAuth()) return super.createImage(payload);

    throw AgentRuntimeError.createError('ProviderBizError', {
      message: 'SuperGrok OAuth is chat-only. Grok Imagine is not in this ChatHub release.',
    });
  }
}
