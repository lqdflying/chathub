import {
  FetchSSEOptions,
  fetchSSE,
  getMessageError,
  standardizeAnimationStyle,
} from '@lobechat/fetch-sse';
import {
  AgentRuntimeError,
  ChatCompletionErrorPayload,
  REASONING_BUDGET_TOKEN_ADAPTIVE,
  supportsAnthropicAdaptiveThinking,
} from '@lobechat/model-runtime';
import { ChatErrorType, TracePayload, TraceTagMap, UIChatMessage } from '@lobechat/types';
import { PluginRequestPayload, createHeadersWithPluginSettings } from '@lobehub/chat-plugin-sdk';
import { merge } from 'lodash-es';
import { ModelProvider } from 'model-bank';

import { enableAuth } from '@/const/auth';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { isDesktop } from '@/const/version';
import { getSearchConfig } from '@/helpers/getSearchConfig';
import { createChatToolsEngine, createToolsEngine } from '@/helpers/toolEngineering';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getSessionStoreState } from '@/store/session';
import { sessionMetaSelectors } from '@/store/session/selectors';
import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { getUserStoreState, useUserStore } from '@/store/user';
import {
  preferenceSelectors,
  userGeneralSettingsSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import type { ChatStreamPayload, OpenAIChatMessage } from '@/types/openai/chat';
import { fetchWithInvokeStream } from '@/utils/electron/desktopRemoteRPCFetch';
import { createErrorResponse } from '@/utils/errorResponse';
import { stripLegacyProviderParams } from '@/utils/stripLegacyProviderParams';
import { createTraceHeader, getTraceId } from '@/utils/trace';

import { createHeaderWithAuth } from '../_auth';
import { API_ENDPOINTS } from '../_url';
import { initializeWithClientStore } from './clientModelRuntime';
import { contextEngineering } from './contextEngineering';
import { findDeploymentName, isEnableFetchOnClient, resolveRuntimeProvider } from './helper';
import { trimMinimaxChatContext } from './trimMinimaxContext';
import { FetchOptions } from './types';

/** Valid Anthropic `reasoningEffort` values — used to guard against boolean/other pollution. */
const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const isAnthropicRuntimeProvider = (provider?: string) =>
  provider === ModelProvider.Anthropic || provider === ModelProvider.AnthropicCompatible;

const openAICompatStoreValue = (store?: 'default' | 'false' | 'true') => {
  if (store === 'true') return true;
  if (store === 'false') return false;
  return undefined;
};

interface GetChatCompletionPayload extends Partial<Omit<ChatStreamPayload, 'messages'>> {
  messages: UIChatMessage[];
}

type ChatStreamInputParams = Partial<Omit<ChatStreamPayload, 'messages'>> & {
  messages?: (UIChatMessage | OpenAIChatMessage)[];
};

interface FetchAITaskResultParams extends FetchSSEOptions {
  abortController?: AbortController;
  onError?: (e: Error, rawError?: any) => void;
  /**
   * 加载状态变化处理函数
   * @param loading - 是否处于加载状态
   */
  onLoadingChange?: (loading: boolean) => void;
  /**
   * 请求对象
   */
  params: ChatStreamInputParams;
  trace?: TracePayload;
}

interface CreateAssistantMessageStream extends FetchSSEOptions {
  abortController?: AbortController;
  historySummary?: string;
  isWelcomeQuestion?: boolean;
  params: GetChatCompletionPayload;
  trace?: TracePayload;
}

class ChatService {
  createAssistantMessage = async (
    { plugins: enabledPlugins, messages, ...params }: GetChatCompletionPayload,
    options?: FetchOptions,
  ) => {
    const payload = merge(
      {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: true,
      },
      params,
    );

    const searchConfig = getSearchConfig(payload.model, payload.provider!);

    // =================== 1. preprocess tools =================== //

    const pluginIds = [...(enabledPlugins || [])];

    const toolsEngine = createChatToolsEngine({
      model: payload.model,
      provider: payload.provider!,
    });

    const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
      model: payload.model,
      provider: payload.provider!,
      toolIds: pluginIds,
    });

    // ============  2. preprocess messages   ============ //

    const agentStoreState = getAgentStoreState();
    const agentConfig = agentSelectors.currentAgentConfig(agentStoreState);
    const chatConfig = agentChatConfigSelectors.currentChatConfig(agentStoreState);

    // Apply context engineering with preprocessing configuration
    let oaiMessages = await contextEngineering({
      enableHistoryCount: agentChatConfigSelectors.enableHistoryCount(agentStoreState),
      // include user messages
      historyCount: agentChatConfigSelectors.historyCount(agentStoreState) + 2,
      historySummary: options?.historySummary,
      inputTemplate: chatConfig.inputTemplate,
      isWelcomeQuestion: options?.isWelcomeQuestion,
      messages,
      model: payload.model,
      provider: payload.provider!,
      sessionId: options?.trace?.sessionId,
      systemRole: agentConfig.systemRole,
      tools: enabledToolIds,
    });

    if (payload.provider === 'minimax') {
      oaiMessages = await trimMinimaxChatContext(
        oaiMessages,
        tools,
        payload.model,
        payload.max_tokens,
      );
    }

    // ============  3. process extend params   ============ //

    let extendParams: Record<string, any> = {};
    const aiInfraStoreState = getAiInfraStoreState();

    const isModelHasExtendParams = aiModelSelectors.isModelHasExtendParams(
      payload.model,
      payload.provider!,
    )(aiInfraStoreState);

    // model
    if (isModelHasExtendParams) {
      const modelExtendParams = aiModelSelectors.modelExtendParams(
        payload.model,
        payload.provider!,
      )(aiInfraStoreState);
      // if model has extended params, then we need to check if the model can use reasoning

      if (modelExtendParams!.includes('enableReasoning')) {
        if (chatConfig.enableReasoning) {
          if (
            isAnthropicRuntimeProvider(payload.provider) &&
            chatConfig.reasoningBudgetToken === REASONING_BUDGET_TOKEN_ADAPTIVE &&
            supportsAnthropicAdaptiveThinking(payload.model)
          ) {
            extendParams.thinking = {
              effort: VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort)
                ? chatConfig.reasoningEffort
                : 'high',
              type: 'adaptive',
            };
          } else {
            extendParams.thinking = {
              budget_tokens: chatConfig.reasoningBudgetToken || 1024,
              type: 'enabled',
              ...(payload.model === 'kimi-k2.6' && chatConfig.moonshotPreservedReasoning
                ? { keep: 'all' as const }
                : {}),
            };
          }
        } else {
          extendParams.thinking = {
            budget_tokens: 0,
            type: 'disabled',
          };
        }
      } else if (modelExtendParams!.includes('reasoningBudgetToken')) {
        if (
          isAnthropicRuntimeProvider(payload.provider) &&
          chatConfig.reasoningBudgetToken === REASONING_BUDGET_TOKEN_ADAPTIVE &&
          supportsAnthropicAdaptiveThinking(payload.model)
        ) {
          extendParams.thinking = {
            effort: VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort)
              ? chatConfig.reasoningEffort
              : 'high',
            type: 'adaptive',
          };
        } else {
          extendParams.thinking = {
            budget_tokens: chatConfig.reasoningBudgetToken || 1024,
            type: 'enabled',
          };
        }
      }

      if (
        modelExtendParams!.includes('disableContextCaching') &&
        chatConfig.disableContextCaching
      ) {
        extendParams.enabledContextCaching = false;
      }

      if (
        modelExtendParams!.includes('reasoningEffort') &&
        (chatConfig.reasoningEffort || chatConfig.enableReasoningEffort)
      ) {
        // DeepSeek only accepts 'high' or 'max' (low/medium map to high, xhigh maps to max)
        // and only when deep thinking is actually enabled
        if (payload.provider === 'deepseek') {
          if (chatConfig.enableReasoning) {
            extendParams.reasoning_effort = 'max';
          }
        } else {
          extendParams.reasoning_effort = VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort)
            ? chatConfig.reasoningEffort
            : undefined;
        }
      }

      if (modelExtendParams!.includes('gpt5ReasoningEffort') && chatConfig.gpt5ReasoningEffort) {
        let effort = chatConfig.gpt5ReasoningEffort as string;
        if (payload.model.startsWith('gpt-5.5') && (effort === 'minimal' || effort === 'none')) {
          effort = 'low';
        }
        extendParams.reasoning_effort = effort;
      }

      if (modelExtendParams!.includes('textVerbosity') && chatConfig.textVerbosity) {
        extendParams.verbosity = chatConfig.textVerbosity;
      }

      if (modelExtendParams!.includes('thinking') && chatConfig.thinking) {
        extendParams.thinking = { type: chatConfig.thinking };
      }

      if (
        modelExtendParams!.includes('thinkingBudget') &&
        chatConfig.thinkingBudget !== undefined
      ) {
        extendParams.thinkingBudget = chatConfig.thinkingBudget;
      }

      if (modelExtendParams!.includes('urlContext') && chatConfig.urlContext) {
        extendParams.urlContext = chatConfig.urlContext;
      }

      if (modelExtendParams!.includes('minimaxReasoningSplit')) {
        extendParams.reasoning_split = chatConfig.minimaxReasoningSplit !== false;
      }
    }

    return this.getChatCompletion(
      {
        ...params,
        ...extendParams,
        enabledSearch: searchConfig.enabledSearch && searchConfig.useModelSearch ? true : undefined,
        messages: oaiMessages,
        tools,
      },
      options,
    );
  };

  createAssistantMessageStream = async ({
    params,
    abortController,
    onAbort,
    onMessageHandle,
    onErrorHandle,
    onFinish,
    trace,
    isWelcomeQuestion,
    historySummary,
  }: CreateAssistantMessageStream) => {
    await this.createAssistantMessage(params, {
      historySummary,
      isWelcomeQuestion,
      onAbort,
      onErrorHandle,
      onFinish,
      onMessageHandle,
      signal: abortController?.signal,
      trace: this.mapTrace(trace, TraceTagMap.Chat),
    });
  };

  getChatCompletion = async (params: Partial<ChatStreamPayload>, options?: FetchOptions) => {
    const { signal, responseAnimation } = options ?? {};

    const { provider = ModelProvider.OpenAI, ...res } = params;

    // =================== process model =================== //
    // ===================================================== //
    let model = res.model || DEFAULT_AGENT_CONFIG.model;

    // if the provider is Azure, get the deployment name as the request model
    const providersWithDeploymentName = [ModelProvider.Azure, ModelProvider.AzureAI] as string[];

    if (providersWithDeploymentName.includes(provider)) {
      model = findDeploymentName(model, provider);
    }

    const aiInfraStoreState = getAiInfraStoreState();
    const apiMode = aiProviderSelectors.isProviderEnableResponseApi(provider)(aiInfraStoreState)
      ? 'responses'
      : undefined;
    const openAICompatCache =
      provider === ModelProvider.OpenAICompatible
        ? aiProviderSelectors.providerOpenAICompatCacheConfig(provider)(aiInfraStoreState)
        : undefined;
    const openAICompatResponsesParams =
      provider === ModelProvider.OpenAICompatible
        ? aiProviderSelectors.providerOpenAICompatResponsesParamsConfig(provider)(aiInfraStoreState)
        : undefined;
    const responseCache = openAICompatCache?.responses;
    const responseCacheEnabled = responseCache?.promptCacheKey === 'derived';
    const responseStateMode =
      apiMode === 'responses' &&
      provider === ModelProvider.OpenAICompatible &&
      responseCacheEnabled
        ? 'provider'
        : undefined;
    const store = apiMode === 'responses' ? openAICompatStoreValue(responseCache?.store) : undefined;

    // Get the chat config to check streaming preference
    const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());

    const payload = stripLegacyProviderParams(
      merge(
        {
          model: DEFAULT_AGENT_CONFIG.model,
          stream: chatConfig.enableStreaming !== false, // Default to true if not set
        },
        {
          ...res,
          apiMode,
          model,
          openAICompatCache,
          openAICompatResponsesParams,
          responseStateMode,
          store,
        },
      ),
    );

    const sdkType = resolveRuntimeProvider(provider);

    /**
     * Use browser agent runtime
     */
    let enableFetchOnClient = isEnableFetchOnClient(provider);

    let fetcher: typeof fetch | undefined = undefined;

    // Add desktop remote RPC fetch support
    if (isDesktop) {
      fetcher = fetchWithInvokeStream;
    } else if (enableFetchOnClient) {
      /**
       * Notes:
       * 1. Browser agent runtime will skip auth check if a key and endpoint provided by
       *    user which will cause abuse of plugins services
       * 2. This feature will be disabled by default
       */
      fetcher = async () => {
        try {
          return await this.fetchOnClient({ payload, provider, runtimeProvider: sdkType, signal });
        } catch (e) {
          const {
            errorType = ChatErrorType.BadRequest,
            error: errorContent,
            ...res
          } = e as ChatCompletionErrorPayload;

          const error = errorContent || e;
          // track the error at server side
          console.error(`Route: [${provider}] ${errorType}:`, error);

          return createErrorResponse(errorType, { error, ...res, provider });
        }
      };
    }

    const traceHeader = createTraceHeader({ ...options?.trace });

    const headers = await createHeaderWithAuth({
      headers: { 'Content-Type': 'application/json', ...traceHeader },
      provider,
    });

    const { DEFAULT_MODEL_PROVIDER_LIST } = await import('@/config/modelProviders');
    const providerConfig = DEFAULT_MODEL_PROVIDER_LIST.find((item) => item.id === provider);

    const userPreferTransitionMode =
      userGeneralSettingsSelectors.transitionMode(getUserStoreState());

    // The order of the array is very important.
    const mergedResponseAnimation = [
      providerConfig?.settings?.responseAnimation || {},
      userPreferTransitionMode,
      responseAnimation,
    ].reduce((acc, cur) => merge(acc, standardizeAnimationStyle(cur)), {});

    return fetchSSE(API_ENDPOINTS.chat(sdkType), {
      body: JSON.stringify(payload),
      fetcher: fetcher,
      headers,
      method: 'POST',
      onAbort: options?.onAbort,
      onErrorHandle: options?.onErrorHandle,
      onFinish: options?.onFinish,
      onMessageHandle: options?.onMessageHandle,
      responseAnimation: mergedResponseAnimation,
      signal,
    });
  };

  /**
   * run the plugin api to get result
   * @param params
   * @param options
   */
  runPluginApi = async (params: PluginRequestPayload, options?: FetchOptions) => {
    const s = getToolStoreState();

    const settings = pluginSelectors.getPluginSettingsById(params.identifier)(s);
    const manifest = pluginSelectors.getToolManifestById(params.identifier)(s);

    const traceHeader = createTraceHeader(this.mapTrace(options?.trace, TraceTagMap.ToolCalling));

    const headers = await createHeaderWithAuth({
      headers: { ...createHeadersWithPluginSettings(settings), ...traceHeader },
    });

    const gatewayURL = manifest?.gateway ?? API_ENDPOINTS.gateway;

    const res = await fetch(gatewayURL, {
      body: JSON.stringify({ ...params, manifest }),
      headers,
      method: 'POST',
      signal: options?.signal,
    });

    if (!res.ok) {
      throw await getMessageError(res);
    }

    const text = await res.text();
    return { text, traceId: getTraceId(res) };
  };

  fetchPresetTaskResult = async ({
    params,
    onMessageHandle,
    onFinish,
    onError,
    onLoadingChange,
    abortController,
    trace,
  }: FetchAITaskResultParams) => {
    const errorHandle = (error: Error, errorContent?: any) => {
      onLoadingChange?.(false);
      if (abortController?.signal.aborted) {
        return;
      }
      onError?.(error, errorContent);
      console.error(error);
    };

    onLoadingChange?.(true);

    try {
      // Use simple tools engine without complex search logic
      const toolsEngine = createToolsEngine();
      const tools = toolsEngine.generateTools({
        model: params.model!,
        provider: params.provider!,
        toolIds: params.plugins,
      });

      let oaiMessages = await contextEngineering({
        messages: params.messages as any,
        model: params.model!,
        provider: params.provider!,
        tools: params.plugins,
      });

      if (params.provider === 'minimax') {
        oaiMessages = await trimMinimaxChatContext(
          oaiMessages,
          tools,
          params.model!,
          params.max_tokens,
        );
      }

      // remove plugins
      delete params.plugins;
      await this.getChatCompletion(
        { ...params, messages: oaiMessages, tools },
        {
          onErrorHandle: (error) => {
            errorHandle(new Error(error.message), error);
          },
          onFinish,
          onMessageHandle,
          signal: abortController?.signal,
          trace: this.mapTrace(trace, TraceTagMap.SystemChain),
        },
      );

      onLoadingChange?.(false);
    } catch (e) {
      errorHandle(e as Error);
    }
  };

  private mapTrace = (trace?: TracePayload, tag?: TraceTagMap): TracePayload => {
    const tags = sessionMetaSelectors.currentAgentMeta(getSessionStoreState()).tags || [];

    const enabled = preferenceSelectors.userAllowTrace(getUserStoreState());

    if (!enabled) return { ...trace, enabled: false };

    return {
      ...trace,
      enabled: true,
      tags: [tag, ...(trace?.tags || []), ...tags].filter(Boolean) as string[],
      userId: userProfileSelectors.userId(useUserStore.getState()),
    };
  };

  /**
   * Fetch chat completion on the client side.

   */
  private fetchOnClient = async (params: {
    payload: Partial<ChatStreamPayload>;
    provider: string;
    runtimeProvider: string;
    signal?: AbortSignal;
  }) => {
    /**
     * if enable login and not signed in, return unauthorized error
     */
    const userStore = useUserStore.getState();
    if (enableAuth && !userStore.isSignedIn) {
      throw AgentRuntimeError.createError(ChatErrorType.InvalidAccessCode);
    }

    const agentRuntime = await initializeWithClientStore({
      payload: params.payload,
      provider: params.provider,
      runtimeProvider: params.runtimeProvider,
    });
    const data = params.payload as ChatStreamPayload;

    return agentRuntime.chat(data, { signal: params.signal });
  };
}

export const chatService = new ChatService();
