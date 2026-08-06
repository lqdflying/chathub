import { LOBE_CHAT_CONTEXT_EXPORT_HEADER } from '@lobechat/const';
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
  createContextExportCaptureBridge,
  prependContextSnapshotToResponse,
  supportsAnthropicAdaptiveThinking,
} from '@lobechat/model-runtime';
import {
  ChatErrorType,
  MAX_ACTIVE_SKILLS,
  ToolCacheDebugMetadata,
  TracePayload,
  TraceTagMap,
  UIChatMessage,
  resolveGPT5ReasoningEffort,
} from '@lobechat/types';
import { PluginRequestPayload, createHeadersWithPluginSettings } from '@lobehub/chat-plugin-sdk';
import { merge } from 'lodash-es';
import { ModelProvider } from 'model-bank';

import { enableAuth } from '@/const/auth';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { getSearchConfig } from '@/helpers/getSearchConfig';
import { createChatToolsEngine, createToolsEngine } from '@/helpers/toolEngineering';
import { skillService } from '@/services/skill';
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
import { createErrorResponse } from '@/utils/errorResponse';
import { stripLegacyProviderParams } from '@/utils/stripLegacyProviderParams';
import { createTraceHeader, getTraceId } from '@/utils/trace';

import { createHeaderWithAuth } from '../_auth';
import { API_ENDPOINTS } from '../_url';
import { initializeWithClientStore } from './clientModelRuntime';
import { composeSystemRole } from './composeSystemRole';
import { contextEngineering } from './contextEngineering';
import { contextExportRedactions, sanitizeContextExportValue } from './contextExport';
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

const SKILL_LOADER_IDENTIFIER = 'lobe-skill-loader';

const firstNonEmpty = (...lists: (string[] | undefined)[]) =>
  lists.find((list) => list && list.length > 0) || [];

const getActivatedSkillIdsFromMetadata = (message?: UIChatMessage): string[] => {
  const activated = message?.metadata?.skills?.activated;
  return Array.isArray(activated)
    ? activated.filter((identifier): identifier is string => typeof identifier === 'string')
    : [];
};

const parseJsonRecord = (content: unknown): Record<string, unknown> | undefined => {
  if (typeof content !== 'string') return;

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return;
  }
};

const isSkillLoaderToolMessage = (message: UIChatMessage) =>
  message.role === 'tool' && message.plugin?.identifier === SKILL_LOADER_IDENTIFIER;

const sanitizeSkillLoaderMessages = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages.map((message) => {
    if (!isSkillLoaderToolMessage(message)) return message;

    const payload = parseJsonRecord(message.content);
    const identifier = typeof payload?.identifier === 'string' ? payload.identifier : undefined;
    const activated = getActivatedSkillIdsFromMetadata(message);
    const metadataActivated = activated.length > 0 ? activated : identifier ? [identifier] : [];
    const metadata =
      metadataActivated.length > 0
        ? {
            ...message.metadata,
            skills: {
              ...message.metadata?.skills,
              activated: [...new Set(metadataActivated)],
            },
          }
        : message.metadata;

    if (!identifier) return metadata === message.metadata ? message : { ...message, metadata };

    return {
      ...message,
      content: JSON.stringify({
        ...(typeof payload?.contentHash === 'string' ? { contentHash: payload.contentHash } : {}),
        identifier,
        name: typeof payload?.name === 'string' ? payload.name : identifier,
        status: 'loaded',
      }),
      metadata,
    };
  });

const collectLatestTurnSkillIds = (messages: UIChatMessage[]) => {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return;

  const ids = getActivatedSkillIdsFromMetadata(messages[latestUserIndex]);

  return ids.length > 0 ? [...new Set(ids)] : undefined;
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
  activatedSkillIds?: string[];
  agentMemory?: FetchOptions['agentMemory'];
  contextExportRequest?: FetchOptions['contextExportRequest'];
  enableMemoryTool?: boolean;
  historySummary?: string;
  isWelcomeQuestion?: boolean;
  onContextEngineered?: FetchOptions['onContextEngineered'];
  params: GetChatCompletionPayload;
  toolCacheDebug?: ToolCacheDebugMetadata;
  trace?: TracePayload;
}

class ChatService {
  createAssistantMessage = async (
    {
      activatedSkillIds: requestActivatedSkillIds,
      messages,
      plugins: enabledPlugins,
      ...params
    }: GetChatCompletionPayload & { activatedSkillIds?: string[] },
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
    const sanitizedMessages = sanitizeSkillLoaderMessages(messages);

    // =================== 1. preprocess tools =================== //

    const pluginIds = [...(enabledPlugins || [])];
    const messageActivatedSkillIds = collectLatestTurnSkillIds(sanitizedMessages);
    const requestedSkillIds = firstNonEmpty(
      options?.activatedSkillIds,
      requestActivatedSkillIds,
      messageActivatedSkillIds,
    );
    const installedSkillMetadata = requestedSkillIds.length
      ? await skillService.getInstalledSkills()
      : [];
    const installedSkillIdSet = new Set(installedSkillMetadata.map(({ identifier }) => identifier));
    const activatedSkillIds = [...new Set(requestedSkillIds)]
      .filter((identifier) => installedSkillIdSet.has(identifier))
      .slice(0, MAX_ACTIVE_SKILLS);
    const activatedSkills = activatedSkillIds.length
      ? await skillService.resolveSkills(activatedSkillIds)
      : [];

    const toolsEngine = createChatToolsEngine(
      {
        model: payload.model,
        provider: payload.provider!,
      },
      { enableMemoryTool: options?.enableMemoryTool },
    );

    const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
      model: payload.model,
      provider: payload.provider!,
      toolIds: pluginIds,
    });

    // ============  2. preprocess messages   ============ //

    const agentStoreState = getAgentStoreState();
    const agentConfig = agentSelectors.currentAgentConfig(agentStoreState);
    const chatConfig = agentChatConfigSelectors.currentChatConfig(agentStoreState);
    const generalInstruction = userGeneralSettingsSelectors.generalInstruction(getUserStoreState());
    const systemRole = composeSystemRole(generalInstruction, agentConfig.systemRole);

    // Apply context engineering with preprocessing configuration
    let oaiMessages = await contextEngineering({
      agentMemory: options?.agentMemory,
      enableHistoryCount: agentChatConfigSelectors.enableHistoryCount(agentStoreState),
      existingSystemRolePolicy: 'prepend',
      historyCount: agentChatConfigSelectors.historyCount(agentStoreState),
      historySummary: options?.historySummary,
      inputTemplate: chatConfig.inputTemplate,
      isWelcomeQuestion: options?.isWelcomeQuestion,
      messages: sanitizedMessages,
      model: payload.model,
      provider: payload.provider!,
      sessionId: options?.trace?.sessionId,
      skills: {
        activated: activatedSkills,
      },
      systemRole,
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
              // Zhipu GLM Preserved Thinking: when true, replay historical reasoning_content
              // unmodified (thinking.clear_thinking=false). The runtime translates this to
              // the gateway-safe wire form ({clear_thinking:false} with no `type`) and
              // strips budget_tokens before sending to Zhipu.
              ...(payload.provider === 'zhipu' && chatConfig.zhipuPreservedThinking
                ? { clear_thinking: false as const }
                : {}),
            };
          }
        } else {
          extendParams.thinking = {
            budget_tokens: 0,
            type: 'disabled',
          };
        }
      } else if (payload.provider === 'zhipu' && modelExtendParams!.includes('zhipuPreservedThinking')) {
        // GLM-4.7 forced-thinking + Preserved Thinking. No `enableReasoning` toggle
        // (thinking forced by Zhipu), but `clear_thinking` is a documented GLM-4.5+
        // capability orthogonal to forced thinking — it controls cross-turn replay,
        // not current-turn thinking. Emit thinking={type:enabled, clear_thinking:false}
        // only when the user enables Preserved Thinking; the runtime translates to the
        // gateway-safe {clear_thinking:false} form and strips budget_tokens. When off,
        // send nothing (thinking stays on by default, history stripped).
        if (chatConfig.zhipuPreservedThinking) {
          extendParams.thinking = {
            budget_tokens: 0,
            clear_thinking: false as const,
            type: 'enabled',
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

      if (modelExtendParams!.includes('gpt5ReasoningEffort')) {
        const { effort, effortValues } = resolveGPT5ReasoningEffort(
          payload.model,
          chatConfig.gpt5ReasoningEffort,
        );
        const hasConfiguredEffort = !!chatConfig.gpt5ReasoningEffort;
        const requiresExplicitHighFloor = effortValues[0] === 'high';

        if (hasConfiguredEffort || requiresExplicitHighFloor) {
          extendParams.reasoning_effort = effort;
        }
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

      // Zhipu GLM-5.2 only: reasoning_effort. UI 'skip' maps to API 'none' (NOT the
      // documented-equivalent 'minimal' — some LiteLLM → vLLM GLM gateways reject
      // 'minimal' with HTTP 400; 'none' is probe-verified). Only sent when thinking
      // is enabled; the runtime drops it otherwise.
      if (
        modelExtendParams!.includes('zhipuReasoningEffort') &&
        chatConfig.enableReasoning &&
        chatConfig.zhipuReasoningEffort
      ) {
        extendParams.reasoning_effort =
          chatConfig.zhipuReasoningEffort === 'skip' ? 'none' : chatConfig.zhipuReasoningEffort;
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
    agentMemory,
    enableMemoryTool,
    activatedSkillIds,
    historySummary,
    toolCacheDebug,
    contextExportRequest,
    onContextEngineered,
    onContextSnapshot,
  }: CreateAssistantMessageStream) => {
    await this.createAssistantMessage(
      {
        ...params,
        ...(toolCacheDebug ? { debugToolCache: toolCacheDebug } : {}),
      },
      {
        activatedSkillIds,
        agentMemory,
        contextExportRequest,
        enableMemoryTool,
        historySummary,
        isWelcomeQuestion,
        onAbort,
        onContextEngineered,
        onContextSnapshot,
        onErrorHandle,
        onFinish,
        onMessageHandle,
        signal: abortController?.signal,
        trace: this.mapTrace(trace, TraceTagMap.Chat),
      },
    );
  };

  getChatCompletion = async (params: Partial<ChatStreamPayload>, options?: FetchOptions) => {
    const { signal, responseAnimation } = options ?? {};

    const { provider = ModelProvider.OpenAI, ...res } = params;

    // =================== process model =================== //
    // ===================================================== //
    const catalogModel = res.model || DEFAULT_AGENT_CONFIG.model;
    let model = catalogModel;

    // if the provider is Azure, get the deployment name as the request model
    const providersWithDeploymentName = [ModelProvider.Azure, ModelProvider.AzureAI] as string[];

    if (providersWithDeploymentName.includes(provider)) {
      model = findDeploymentName(model, provider);
    }

    const aiInfraStoreState = getAiInfraStoreState();
    const supportsOpenAICompatResponses = provider === ModelProvider.OpenAICompatible;
    const configuredApiMode =
      supportsOpenAICompatResponses &&
      aiProviderSelectors.isProviderEnableResponseApi(provider)(aiInfraStoreState)
        ? 'responses'
        : undefined;
    const apiMode = supportsOpenAICompatResponses ? res.apiMode || configuredApiMode : undefined;
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
      apiMode === 'responses' && provider === ModelProvider.OpenAICompatible && responseCacheEnabled
        ? 'provider'
        : undefined;
    const store =
      apiMode === 'responses' ? openAICompatStoreValue(responseCache?.store) : undefined;

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
          catalogModel: providersWithDeploymentName.includes(provider) ? catalogModel : undefined,
          model,
          openAICompatCache,
          openAICompatResponsesParams,
          responseStateMode,
          store,
        },
      ),
    );

    const sdkType = resolveRuntimeProvider(provider);

    if (options?.contextExportRequest && options.onContextEngineered) {
      options.onContextEngineered({
        engineeredInput: sanitizeContextExportValue(payload),
        metadata: {
          apiMode: apiMode === 'responses' ? 'responses' : 'chatCompletion',
          model,
          provider,
          runtime: sdkType,
        },
        request: options.contextExportRequest,
      });
    }

    /**
     * Use browser agent runtime
     */
    let enableFetchOnClient = isEnableFetchOnClient(provider);

    let fetcher: typeof fetch | undefined = undefined;

    if (enableFetchOnClient) {
      /**
       * Notes:
       * 1. Browser agent runtime will skip auth check if a key and endpoint provided by
       *    user which will cause abuse of plugins services
       * 2. This feature will be disabled by default
       */
      fetcher = async () => {
        try {
          return await this.fetchOnClient({
            contextExportRequest: options?.contextExportRequest,
            payload,
            provider,
            runtimeProvider: sdkType,
            signal,
          });
        } catch (e) {
          const wrappedError = e as ChatCompletionErrorPayload & {
            contextExportSnapshot?: unknown;
          };
          const originalError = wrappedError.contextExportSnapshot ? (wrappedError.error ?? e) : e;
          const {
            errorType = ChatErrorType.BadRequest,
            error: errorContent,
            ...res
          } = originalError as ChatCompletionErrorPayload;

          const error = errorContent || originalError;
          // track the error at server side
          console.error(`Route: [${provider}] ${errorType}:`, error);

          return createErrorResponse(errorType, {
            ...(wrappedError.contextExportSnapshot
              ? { contextExportSnapshot: wrappedError.contextExportSnapshot }
              : {}),
            error,
            ...res,
            provider,
          });
        }
      };
    }

    const traceHeader = createTraceHeader({ ...options?.trace });

    const headers = await createHeaderWithAuth({
      headers: {
        'Content-Type': 'application/json',
        ...traceHeader,
        ...(options?.contextExportRequest
          ? {
              [LOBE_CHAT_CONTEXT_EXPORT_HEADER]: JSON.stringify(options.contextExportRequest),
            }
          : {}),
      },
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

    return fetchSSE(API_ENDPOINTS.chat(provider), {
      body: JSON.stringify(payload),
      fetcher: fetcher,
      headers,
      method: 'POST',
      onAbort: options?.onAbort,
      onContextSnapshot: options?.onContextSnapshot,
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
    contextExportRequest?: FetchOptions['contextExportRequest'];
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

    const contextExportBridge = params.contextExportRequest
      ? createContextExportCaptureBridge(sanitizeContextExportValue)
      : undefined;
    let response: Response;

    try {
      response = await agentRuntime.chat(data, {
        ...(contextExportBridge
          ? { onRequestPrepared: contextExportBridge.onRequestPrepared }
          : {}),
        signal: params.signal,
      });
    } catch (error) {
      const preparedSnapshot = contextExportBridge?.getSnapshot();
      if (!params.contextExportRequest || !preparedSnapshot) throw error;

      const contextExportSnapshot = {
        ...params.contextExportRequest,
        error: 'Provider request rejected before streaming began',
        metadata: {
          apiMode: preparedSnapshot.apiMode as any,
          model: data.model,
          provider: params.provider,
          runtime: params.runtimeProvider,
        },
        providerRequest: preparedSnapshot.providerRequest,
        redactions: contextExportRedactions,
        status: 'error' as const,
      };

      throw { contextExportSnapshot, error };
    }

    if (!params.contextExportRequest || !contextExportBridge) return response;

    return prependContextSnapshotToResponse(
      response,
      contextExportBridge.snapshot.then(({ apiMode, providerRequest }) => ({
        ...params.contextExportRequest!,
        metadata: {
          apiMode: apiMode as any,
          model: data.model,
          provider: params.provider,
          runtime: params.runtimeProvider,
        },
        providerRequest,
        redactions: contextExportRedactions,
        status: 'complete',
      })),
    );
  };
}

export const chatService = new ChatService();
