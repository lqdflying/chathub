import Anthropic, { ClientOptions } from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import { LobeRuntimeAI } from '../../core/BaseAI';
import {
  createModelCacheDiagnosticCallbacks,
  emitModelCacheRequest,
  emitModelCacheTerminalError,
} from '../../core/cacheDiagnostics';
import { buildAnthropicMessages, buildAnthropicTools } from '../../core/contextBuilders/anthropic';
import { MODEL_PARAMETER_CONFLICTS, resolveParameters } from '../../core/parameterResolver';
import { AnthropicStream, tapAsyncIterable } from '../../core/streams';
import { mergeMultipleChatMethodOptions } from '../../helpers';
import {
  type ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { createChunkDebugTap, debugRequestPayload } from '../../utils/debugStream';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPricing } from '../../utils/getModelPricing';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { debugProviderRequest } from '../../utils/providerDebug';
import { StreamingResponse } from '../../utils/response';
import { createAnthropicGenerateObject } from './generateObject';
import { handleAnthropicError } from './handleAnthropicError';
import { anthropicAdaptiveCapableModels } from './thinkingCapabilities';

export interface AnthropicModelCard {
  created_at: string;
  display_name: string;
  id: string;
}

type anthropicTools = Anthropic.Tool | Anthropic.WebSearchTool20250305;

const modelsWithSmallContextWindow = new Set(['claude-3-opus-20240229', 'claude-3-haiku-20240307']);

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_CACHE_TTL = '5m' as const;

/**
 * The Anthropic JS SDK posts to `/v1/messages` relative to `baseURL`.
 * Many proxies (incl. OpenAI-style gateways) are configured as `https://host/v1`,
 * which would otherwise produce `https://host/v1/v1/messages` → 404.
 */
export const normalizeAnthropicBaseURL = (baseURL: string): string => {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(trimmed)) return trimmed.replace(/\/v1$/i, '');
  return trimmed;
};

type CacheTTL = Anthropic.Messages.CacheControlEphemeral['ttl'];

interface AnthropicCachePolicy {
  breakpointCount: number;
  ttl?: '1h' | '5m' | 'mixed';
}

/**
 * Summarizes explicit cache breakpoints from the final Anthropic request.
 * An omitted TTL is Anthropic's documented 5-minute default.
 */
const resolveAnthropicCachePolicy = (
  anthropicPayload: Anthropic.MessageCreateParams,
): AnthropicCachePolicy => {
  const cacheTTLs: Array<NonNullable<CacheTTL>> = [];
  const recordCacheControl = (
    cacheControl: Anthropic.Messages.CacheControlEphemeral | null | undefined,
  ) => {
    if (!cacheControl) return;
    cacheTTLs.push(cacheControl.ttl ?? DEFAULT_CACHE_TTL);
  };

  if (Array.isArray(anthropicPayload.system)) {
    for (const block of anthropicPayload.system) recordCacheControl(block.cache_control);
  }

  for (const message of anthropicPayload.messages ?? []) {
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if ('cache_control' in block) recordCacheControl(block.cache_control);
    }
  }

  for (const tool of anthropicPayload.tools ?? []) {
    if ('cache_control' in tool) recordCacheControl(tool.cache_control);
  }

  const distinctTTLs = new Set(cacheTTLs);
  return {
    breakpointCount: cacheTTLs.length,
    ttl: distinctTTLs.size > 1 ? 'mixed' : cacheTTLs.length > 0 ? cacheTTLs[0] : undefined,
  };
};

/**
 * System message content can be a plain string or a structured content-part
 * array (e.g. after MessageContentProcessor). Flatten it to Anthropic text
 * blocks — a blind `as string` cast would serialize arrays as garbage and
 * defeat the system-level cache breakpoint.
 * `cache_control` goes on the LAST block only: Anthropic caches everything up
 * to (and including) the marked block.
 */
export const buildAnthropicSystemPrompts = (
  content: unknown,
  enabledContextCaching: boolean,
): Anthropic.TextBlockParam[] | undefined => {
  const texts: string[] =
    typeof content === 'string'
      ? content
        ? [content]
        : []
      : Array.isArray(content)
        ? content
            .filter((part: any) => part?.type === 'text' && !!part.text)
            .map((part: any) => part.text as string)
        : [];

  if (texts.length === 0) return undefined;

  return texts.map((text, index) => ({
    cache_control:
      enabledContextCaching && index === texts.length - 1
        ? { type: 'ephemeral' as const }
        : undefined,
    text,
    type: 'text' as const,
  }));
};

interface AnthropicAIParams extends ClientOptions {
  id?: string;
}

export class LobeAnthropicAI implements LobeRuntimeAI {
  private client: Anthropic;

  baseURL: string;
  apiKey?: string;
  protected authToken?: string;
  private id: string;

  private isDebug() {
    return (
      process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION === '1' ||
      (this.id === ModelProvider.AnthropicCompatible &&
        process.env.DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION === '1')
    );
  }

  constructor({
    apiKey,
    authToken,
    baseURL = DEFAULT_BASE_URL,
    id,
    defaultHeaders,
    ...res
  }: AnthropicAIParams = {}) {
    if (!apiKey && !authToken)
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    const betaHeaders = process.env.ANTHROPIC_BETA_HEADERS;
    const resolvedBaseURL = normalizeAnthropicBaseURL(baseURL);

    this.client = new Anthropic({
      apiKey: apiKey ?? null,
      authToken,
      baseURL: resolvedBaseURL,
      defaultHeaders: { ...defaultHeaders, 'anthropic-beta': betaHeaders },
      ...res,
    });
    this.baseURL = this.client.baseURL;
    this.apiKey = apiKey;
    this.authToken = authToken;
    this.id = id || ModelProvider.Anthropic;
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    let cacheRequestHash: string | undefined;

    try {
      const anthropicPayload = await this.buildAnthropicPayload(payload);
      const inputStartAt = Date.now();
      const cachePolicy = resolveAnthropicCachePolicy(anthropicPayload);
      const hasCacheControl = cachePolicy.breakpointCount > 0;
      const requestPayload = {
        ...anthropicPayload,
        metadata: options?.user ? { user_id: options?.user } : undefined,
        stream: true,
      };
      cacheRequestHash = emitModelCacheRequest(options?.cacheDiagnostics, {
        apiType: 'anthropic-messages',
        cacheMechanism: hasCacheControl ? 'explicit-breakpoint' : 'passive',
        cachePolicy: {
          cacheControl: hasCacheControl,
          cacheControlBreakpointCount: cachePolicy.breakpointCount,
          cacheTTL: cachePolicy.ttl,
        },
        cacheSupport: 'supported',
        inputItemCount: anthropicPayload.messages.length,
        model: payload.model,
        requestFingerprintSource: {
          messages: anthropicPayload.messages,
          model: payload.model,
          system: anthropicPayload.system,
          tools: anthropicPayload.tools,
        },
        stream: true,
        toolCount: anthropicPayload.tools?.length ?? 0,
      });
      const cacheDiagnosticCallbacks = createModelCacheDiagnosticCallbacks(
        options?.cacheDiagnostics,
        {
          apiType: 'anthropic-messages',
          cacheSupport: 'supported',
          requestHash: cacheRequestHash,
        },
      );
      const callbacks = cacheDiagnosticCallbacks
        ? mergeMultipleChatMethodOptions([
            { callback: options?.callback },
            { callback: cacheDiagnosticCallbacks },
          ]).callback
        : options?.callback;

      if (this.isDebug()) {
        debugProviderRequest({
          baseURL: this.baseURL,
          payload: requestPayload,
          provider: this.id,
          route: '/v1/messages',
        });
        debugRequestPayload(anthropicPayload);
      }

      await options?.onRequestPrepared?.(requestPayload, { apiMode: 'messages' });
      let response = await this.client.messages.create(requestPayload, {
        signal: options?.signal,
      });

      if (this.isDebug()) {
        const chunkTap = createChunkDebugTap();
        response = tapAsyncIterable(response, chunkTap.onChunk, chunkTap.onDone);
      }

      const pricing = await getModelPricing(payload.model, this.id);
      const pricingOptions =
        cachePolicy.ttl && cachePolicy.ttl !== 'mixed'
          ? { lookupParams: { ttl: cachePolicy.ttl } }
          : undefined;

      return StreamingResponse(
        AnthropicStream(response, {
          callbacks,
          inputStartAt,
          payload: {
            cacheDiagnostics: options?.cacheDiagnostics,
            cacheRequestHash,
            model: payload.model,
            pricing,
            pricingOptions,
            provider: this.id,
          },
        }),
        {
          headers: options?.headers,
          onCancel: async (reason) => {
            await Promise.allSettled([
              callbacks?.onCancel?.(reason),
              cacheDiagnosticCallbacks?.onError?.(reason),
            ]);
          },
        },
      );
    } catch (error) {
      emitModelCacheTerminalError(options?.cacheDiagnostics, {
        apiType: 'anthropic-messages',
        error,
        requestHash: cacheRequestHash,
      });
      throw this.handleError(error);
    }
  }

  async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    try {
      return await createAnthropicGenerateObject(this.client, payload, options);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async buildAnthropicPayload(payload: ChatStreamPayload) {
    const {
      messages,
      model,
      max_tokens,
      temperature,
      top_p,
      tools,
      thinking,
      enabledContextCaching = true,
      enabledSearch,
    } = payload;

    const { anthropic: anthropicModels } = await import('model-bank');
    const modelConfig = anthropicModels.find((m) => m.id === model);
    const defaultMaxOutput = modelConfig?.maxOutput;

    // 配置优先级：用户设置 > 模型配置 > 硬编码默认值
    const getMaxTokens = () => {
      if (max_tokens) return max_tokens;
      if (defaultMaxOutput) return defaultMaxOutput;
      return undefined;
    };

    const system_message = messages.find((m) => m.role === 'system');
    const user_messages = messages.filter((m) => m.role !== 'system');

    const systemPrompts = buildAnthropicSystemPrompts(
      system_message?.content,
      enabledContextCaching,
    );

    const postMessages = await buildAnthropicMessages(user_messages, { enabledContextCaching });

    let postTools: anthropicTools[] | undefined = buildAnthropicTools(tools, {
      enabledContextCaching,
    });

    if (enabledSearch) {
      // Limit the number of searches per request
      const maxUses = process.env.ANTHROPIC_MAX_USES;

      const webSearchTool: Anthropic.WebSearchTool20250305 = {
        name: 'web_search',
        type: 'web_search_20250305',
        ...(maxUses &&
          Number.isInteger(Number(maxUses)) &&
          Number(maxUses) > 0 && {
            max_uses: Number(maxUses),
          }),
      };

      // 如果已有工具，则添加到现有工具列表中；否则创建新的工具列表
      if (postTools && postTools.length > 0) {
        postTools = [...postTools, webSearchTool];
      } else {
        postTools = [webSearchTool];
      }
    }

    const maxThinkingTokens = () => getMaxTokens() || 32_000; // Claude Opus 4 has minimum maxOutput

    if (!!thinking && thinking.type === 'adaptive' && anthropicAdaptiveCapableModels.has(model)) {
      const maxTokens = maxThinkingTokens();
      const effort = thinking.effort ?? 'high';

      return {
        max_tokens: maxTokens,
        messages: postMessages,
        model,
        output_config: { effort },
        system: systemPrompts,
        thinking: { type: 'adaptive' },
        tools: postTools,
      } as Anthropic.MessageCreateParams;
    }

    if (!!thinking && thinking.type === 'enabled') {
      const maxTokens = maxThinkingTokens();

      // `temperature` may only be set to 1 when thinking is enabled.
      // `top_p` must be unset when thinking is enabled.
      return {
        max_tokens: maxTokens,
        messages: postMessages,
        model,
        system: systemPrompts,
        thinking: {
          budget_tokens: thinking.budget_tokens
            ? Math.min(thinking.budget_tokens, maxTokens - 1) // `max_tokens` must be greater than `thinking.budget_tokens`.
            : 1024,
          type: 'enabled',
        },
        tools: postTools,
      } satisfies Anthropic.MessageCreateParams;
    }

    // Resolve temperature and top_p parameters based on model constraints
    const hasConflict = MODEL_PARAMETER_CONFLICTS.ANTHROPIC_CLAUDE_4_PLUS.has(model);
    const resolvedParams = resolveParameters(
      { temperature, top_p },
      { hasConflict, normalizeTemperature: true, preferTemperature: true },
    );

    return {
      // claude 3 series model hax max output token of 4096, 3.x series has 8192
      // https://docs.anthropic.com/en/docs/about-claude/models/all-models#:~:text=200K-,Max%20output,-Normal%3A
      max_tokens: getMaxTokens() || (modelsWithSmallContextWindow.has(model) ? 4096 : 8192),
      messages: postMessages,
      model,
      system: systemPrompts,
      temperature: resolvedParams.temperature,
      tools: postTools,
      top_p: resolvedParams.top_p,
    } satisfies Anthropic.MessageCreateParams;
  }

  async models() {
    const url = `${this.baseURL}/v1/models`;
    const response = await fetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        ...(this.authToken
          ? { Authorization: `Bearer ${this.authToken}` }
          : { 'x-api-key': `${this.apiKey}` }),
      },
      method: 'GET',
    });
    const json = await response.json();

    const modelList: AnthropicModelCard[] = json['data'];

    const standardModelList = modelList.map((model) => ({
      created: model.created_at,
      displayName: model.display_name,
      id: model.id,
    }));
    return processModelList(standardModelList, MODEL_LIST_CONFIGS.anthropic, 'anthropic');
  }

  private handleError(error: any): ChatCompletionErrorPayload {
    let desensitizedEndpoint = this.baseURL;

    if (this.baseURL !== DEFAULT_BASE_URL) {
      desensitizedEndpoint = desensitizeUrl(this.baseURL);
    }

    if ('status' in (error as any)) {
      switch ((error as Response).status) {
        case 401: {
          throw AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: error as any,
            errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
            provider: this.id,
          });
        }

        case 403: {
          throw AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: error as any,
            errorType: AgentRuntimeErrorType.LocationNotSupportError,
            provider: this.id,
          });
        }
        default: {
          break;
        }
      }
    }

    const { errorResult } = handleAnthropicError(error);

    throw AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: this.id,
    });
  }
}

export default LobeAnthropicAI;
