/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { LOBE_PROVIDER_BUILTIN_IDENTIFIER, ToolNameResolver } from '@lobechat/context-engine';
import {
  ChatErrorType,
  ChatMessageError,
  ChatPluginPayload,
  ChatToolPayload,
  CreateMessageParams,
  MessageToolCall,
  ToolCacheDebugMetadata,
  ToolDiagnosticRuntimeType,
  ToolDiagnosticTerminalOutcome,
  ToolsCallingContext,
  UIChatMessage,
  createToolCallSetCorrelation,
  createToolResultDebugSummary,
} from '@lobechat/types';
import { LobeChatPluginManifest, PluginErrorType } from '@lobehub/chat-plugin-sdk';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { nanoid } from 'nanoid';
import { StateCreator } from 'zustand/vanilla';

import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { chatService } from '@/services/chat';
import { mcpService } from '@/services/mcp';
import { createMCPChatMessageError } from '@/services/mcpError';
import { messageService } from '@/services/message';
import { toolTelemetryService } from '@/services/toolTelemetry';
import type { AccountMutationSnapshot } from '@/store/accountMutation';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import { resolveConversationClearGeneration } from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey, parseMessageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { builtinTools } from '@/tools';
import { merge } from '@/utils/merge';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { setNamespace } from '@/utils/storeDebug';

import { preventLeavingFn, toggleBooleanList } from '../../utils';
import { chatSelectors } from '../message/selectors';
import { threadSelectors } from '../thread/selectors';

const n = setNamespace('plugin');

interface ToolBatchExecutionResult {
  data: unknown;
  diagnosticId?: string;
  id?: string;
  outcome: ToolDiagnosticTerminalOutcome;
  payload: ExecutableChatToolPayload;
  runtimeType?: ToolDiagnosticRuntimeType;
  shouldContinue?: boolean;
}

interface ToolInvocationResult {
  data: unknown;
  outcome?: ToolDiagnosticTerminalOutcome;
  shouldContinue?: boolean;
}

interface PluginMessageResource {
  mapKey: string;
  message: UIChatMessage;
  messageId: string;
  sessionId?: string;
  topicId?: string | null;
}

const createPluginMessageResource = (
  mapKey: string,
  message: UIChatMessage,
): PluginMessageResource => {
  const mapContext = parseMessageMapKey(mapKey);

  return {
    mapKey,
    message,
    messageId: message.id,
    sessionId: message.sessionId ?? message.groupId ?? mapContext?.sessionId,
    topicId: message.topicId ?? mapContext?.topicId,
  };
};

const resolvePluginMessageResource = (
  state: ChatStore,
  messageId: string,
): PluginMessageResource | undefined => {
  for (const [mapKey, messages] of Object.entries(state.messagesMap)) {
    const message = messages.find(({ id }) => id === messageId);
    if (!message) continue;

    return createPluginMessageResource(mapKey, message);
  }
};

const isPluginMessageResourceCurrent = (
  state: ChatStore,
  resource: PluginMessageResource | undefined,
): boolean => {
  if (!resource) return true;

  const currentMessage = state.messagesMap[resource.mapKey]?.find(
    ({ id }) => id === resource.messageId,
  );
  if (!currentMessage) return false;
  const currentResource = createPluginMessageResource(resource.mapKey, currentMessage);

  if (resource.sessionId && currentResource.sessionId !== resource.sessionId) {
    return false;
  }

  if (resource.topicId !== undefined && currentResource.topicId !== resource.topicId) {
    return false;
  }

  return true;
};

const isPluginMutationCurrent = (
  state: ChatStore,
  accountMutationSnapshot: AccountMutationSnapshot,
  resource: PluginMessageResource | undefined,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
  isPluginMessageResourceCurrent(state, resource);

const createResourceConversationContext = (
  resource: PluginMessageResource | undefined,
  state: Pick<
    ChatStore,
    | 'conversationClearGeneration'
    | 'conversationNavigationGeneration'
    | 'conversationScopedClearGenerations'
  >,
): ConversationContext | undefined => {
  if (!resource?.sessionId) return;

  return {
    clearGeneration: resolveConversationClearGeneration(
      state,
      resource.sessionId,
      resource.topicId,
    ),
    generation: state.conversationNavigationGeneration,
    sessionId: resource.sessionId,
    topicId: resource.topicId,
  };
};

const isPluginMessageResourceActive = (
  state: ChatStore,
  resource: PluginMessageResource | undefined,
): boolean => !resource || resource.mapKey === messageMapKey(state.activeId, state.activeTopicId);

const createResourceDispatchContext = (
  state: ChatStore,
  resource: PluginMessageResource | undefined,
) => {
  if (!resource?.sessionId || isPluginMessageResourceActive(state, resource)) return;

  return { sessionId: resource.sessionId, topicId: resource.topicId };
};

const dispatchPluginMessage = (
  state: ChatStore,
  resource: PluginMessageResource | undefined,
  payload: Parameters<ChatStore['internal_dispatchMessage']>[0],
) => {
  const dispatchContext = createResourceDispatchContext(state, resource);
  if (dispatchContext) {
    state.internal_dispatchMessage(payload, dispatchContext);
  } else {
    state.internal_dispatchMessage(payload);
  }
};

const getPluginMessageById = (state: ChatStore, messageId: string): UIChatMessage | undefined =>
  resolvePluginMessageResource(state, messageId)?.message;

const resolveToolDiagnosticRuntimeType = (
  payload: ExecutableChatToolPayload,
): ToolDiagnosticRuntimeType => {
  if (payload.identifier === LOBE_PROVIDER_BUILTIN_IDENTIFIER) return 'delegated';
  if (payload.type === 'mcp') return 'mcp';
  if (payload.type === 'builtin') return 'builtin';
  if (payload.type === 'markdown') return 'markdown';
  if (payload.type === 'standalone') return 'standalone';
  return 'default';
};

const isAbortError = (error: unknown) => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      const message = current.message.toLowerCase();
      if (
        current.name === 'AbortError' ||
        message === 'aborterror' ||
        message.includes('user aborted') ||
        message.includes('operation was aborted')
      ) {
        return true;
      }
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
};

type MCPChatToolPayload = Omit<ChatToolPayload, 'type'> & { type: 'mcp' };
type ExecutableChatToolPayload = ChatToolPayload | MCPChatToolPayload;

export interface ChatPluginAction {
  createAssistantMessageByPlugin: (content: string, parentId: string) => Promise<void>;
  fillPluginMessageContent: (
    id: string,
    content: string,
    triggerAiMessage?: boolean,
  ) => Promise<void>;

  invokeBuiltinTool: (
    id: string,
    payload: ChatToolPayload,
    diagnosticId?: string,
  ) => Promise<ToolInvocationResult>;
  /** Moonshot-style provider builtins: echo tool arguments as tool result, then continue chat */
  invokeProviderBuiltinTool: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;
  invokeDefaultTypePlugin: (id: string, payload: ChatPluginPayload) => Promise<string | undefined>;
  invokeMarkdownTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;
  invokeMCPTypePlugin: (
    id: string,
    payload: MCPChatToolPayload,
    toolCacheDebug?: ToolCacheDebugMetadata,
    requestedDiagnosticId?: string,
  ) => Promise<ToolInvocationResult>;

  invokeStandaloneTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;

  reInvokeToolMessage: (id: string) => Promise<void>;
  triggerAIMessage: (params: {
    contextExportCaptureId?: string;
    expectedConversationVersion?: number;
    parentId?: string;
    traceId?: string;
    threadId?: string;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
    toolCacheDebug?: ToolCacheDebugMetadata;
  }) => Promise<void>;
  summaryPluginContent: (id: string) => Promise<void>;

  /**
   * @deprecated V1 method
   */
  triggerToolCalls: (
    id: string,
    params?: {
      contextExportCaptureId?: string;
      expectedConversationVersion?: number;
      threadId?: string;
      inPortalThread?: boolean;
      inSearchWorkflow?: boolean;
    },
  ) => Promise<void>;
  updatePluginState: (id: string, value: any) => Promise<void>;
  updatePluginArguments: <T = any>(id: string, value: T, replace?: boolean) => Promise<void>;

  internal_addToolToAssistantMessage: (id: string, tool: ChatToolPayload) => Promise<void>;
  internal_removeToolToAssistantMessage: (id: string, tool_call_id?: string) => Promise<void>;
  /**
   * use the optimistic update value to update the message tools to database
   */
  internal_refreshToUpdateMessageTools: (id: string) => Promise<void>;

  internal_callPluginApi: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;
  internal_invokeDifferentTypePlugin: (
    id: string,
    payload: ExecutableChatToolPayload,
    toolCacheDebug?: ToolCacheDebugMetadata,
    diagnosticId?: string,
  ) => Promise<ToolInvocationResult>;
  internal_togglePluginApiCalling: (
    loading: boolean,
    id?: string,
    action?: string,
    expectedAbortController?: AbortController,
  ) => AbortController | undefined;
  internal_transformToolCalls: (toolCalls: MessageToolCall[]) => ChatToolPayload[];
  internal_updatePluginError: (id: string, error: ChatMessageError) => Promise<void>;
  internal_constructToolsCallingContext: (id: string) => ToolsCallingContext | undefined;
}

export const chatPlugin: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPluginAction
> = (set, get) => ({
  createAssistantMessageByPlugin: async (content, parentId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId;
    const newMessage: CreateMessageParams = {
      content,
      parentId,
      role: 'assistant',
      sessionId: get().activeId,
      topicId: get().activeTopicId, // if there is activeTopicId，then add it to topicId
    };

    await messageService.createMessage(newMessage);
    if (isCurrentRequest()) await get().refreshMessages();
  },

  fillPluginMessageContent: async (id, content, triggerAiMessage) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource);
    const { triggerAIMessage, internal_updateMessageContent } = get();

    if (conversationContext && !isPluginMessageResourceActive(get(), messageResource)) {
      await internal_updateMessageContent(id, content, { conversationContext });
    } else {
      await internal_updateMessageContent(id, content);
    }
    if (!invocationIsCurrent()) return;

    if (triggerAiMessage && isPluginMessageResourceActive(get(), messageResource)) {
      await triggerAIMessage({ parentId: id });
    }
  },
  invokeBuiltinTool: async (id, payload, diagnosticId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) {
      return { data: undefined, outcome: 'cancelled', shouldContinue: false };
    }

    const { internal_togglePluginApiCalling } = get();
    const messageResource = resolvePluginMessageResource(get(), id);
    const params = JSON.parse(payload.arguments);
    const abortController = internal_togglePluginApiCalling(
      true,
      id,
      n('invokeBuiltinTool/start') as string,
    );
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource) &&
      !abortController?.signal.aborted;

    try {
      let data;
      try {
        data = await useToolStore
          .getState()
          .transformApiArgumentsToAiState(payload.apiName, params, invocationIsCurrent);
      } catch (error) {
        if (!invocationIsCurrent()) {
          return { data: undefined, outcome: 'cancelled', shouldContinue: false };
        }

        const err = error as Error;
        console.error(err);

        const tool = builtinTools.find((tool) => tool.identifier === payload.identifier);
        const schema = tool?.manifest?.api.find((api) => api.name === payload.apiName)?.parameters;

        await get().internal_updatePluginError(id, {
          type: ChatErrorType.PluginFailToTransformArguments,
          body: {
            message:
              "[plugin] fail to transform plugin arguments to ai state, it may due to model's limited tools calling capacity. You can refer to https://lobehub.com/docs/usage/tools-calling for more detail.",
            stack: err.stack,
            arguments: params,
            schema,
          },
          message: '',
        });
      }

      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      if (!data) {
        return {
          data: undefined,
          outcome: 'skipped',
          shouldContinue: false,
        };
      }

      await get().internal_updateMessageContent(id, data);
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      // run tool api call
      // postToolCalling
      // @ts-ignore
      const { [payload.apiName]: action } = get();
      if (!action) {
        return {
          data: undefined,
          outcome: 'skipped',
          shouldContinue: false,
        };
      }

      let content;

      try {
        content = JSON.parse(data);
      } catch {
        /* empty block */
      }

      if (!content) {
        return {
          data: undefined,
          outcome: 'skipped',
          shouldContinue: false,
        };
      }

      const actionResult = await action(id, content, undefined, diagnosticId);
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      if (
        actionResult &&
        typeof actionResult === 'object' &&
        'data' in actionResult &&
        'outcome' in actionResult
      ) {
        return actionResult as ToolInvocationResult;
      }

      const updatedMessage = getPluginMessageById(get(), id);
      const diagnosticError = updatedMessage?.error ?? updatedMessage?.pluginError;

      return {
        data: diagnosticError ?? updatedMessage?.content,
        outcome: diagnosticError ? 'failed' : actionResult === undefined ? 'skipped' : 'completed',
        shouldContinue: actionResult === true,
      };
    } finally {
      if (invocationIsCurrent()) {
        if (abortController) {
          internal_togglePluginApiCalling(
            false,
            id,
            n('invokeBuiltinTool/end') as string,
            abortController,
          );
        } else {
          internal_togglePluginApiCalling(false, id, n('invokeBuiltinTool/end') as string);
        }
      }
    }
  },

  invokeProviderBuiltinTool: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { internal_updateMessageContent } = get();
    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    // Kimi / Moonshot `$web_search`: submit `tool_call.function.arguments` verbatim as the
    // tool message content so the next completion can run search (see Moonshot docs).
    const content =
      typeof payload.arguments === 'string' && payload.arguments.trim().length > 0
        ? payload.arguments
        : '{}';
    if (conversationContext && !isPluginMessageResourceActive(get(), messageResource)) {
      await internal_updateMessageContent(id, content, { conversationContext });
    } else {
      await internal_updateMessageContent(id, content);
    }
    return content;
  },

  invokeDefaultTypePlugin: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { internal_callPluginApi } = get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  },

  invokeMarkdownTypePlugin: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { internal_callPluginApi } = get();

    await internal_callPluginApi(id, payload);
  },

  invokeStandaloneTypePlugin: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource);
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result || !invocationIsCurrent()) return;

    // if the plugin settings is not valid, then set the message with error type
    if (!result.valid) {
      await messageService.updateMessageError(id, {
        body: {
          error: result.errors,
          message: '[plugin] your settings is invalid with plugin manifest setting schema',
        },
        message: t('response.PluginSettingsInvalid', { ns: 'error' }),
        type: PluginErrorType.PluginSettingsInvalid as any,
      });

      if (invocationIsCurrent()) {
        await get().refreshMessages(
          isPluginMessageResourceActive(get(), messageResource) ? undefined : conversationContext,
        );
      }
      return;
    }
  },

  reInvokeToolMessage: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const message = getPluginMessageById(get(), id);
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      get().internal_updateMessagePluginError(id, null);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await get().internal_invokeDifferentTypePlugin(id, payload);
  },

  triggerAIMessage: async ({
    contextExportCaptureId,
    expectedConversationVersion,
    parentId,
    traceId,
    threadId,
    inPortalThread,
    inSearchWorkflow,
    toolCacheDebug,
  }) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const { internal_coreProcessMessage } = get();

    // Pass the complete conversation to the shared context-engine truncation.
    // Pre-slicing here makes automatic tool continuations use a different
    // history boundary than the user request that produced the tool calls,
    // which breaks byte-identical prompt-cache prefixes.
    const chats = inPortalThread
      ? threadSelectors.portalAIChats(get())
      : chatSelectors.mainAIChats(get());

    await internal_coreProcessMessage(chats, parentId ?? chats.at(-1)!.id, {
      contextExportCaptureId,
      expectedConversationVersion,
      traceId,
      threadId,
      inPortalThread,
      inSearchWorkflow,
      isToolContinuation: true,
      toolCacheDebug,
    });
  },

  summaryPluginContent: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const message = isPluginMessageResourceActive(get(), messageResource)
      ? chatSelectors.getMessageById(id)(get())
      : messageResource?.message;
    if (!message || message.role !== 'tool') return;

    await get().internal_coreProcessMessage(
      [
        {
          role: 'assistant',
          content: '作为一名总结专家，请结合以上系统提示词，将以下内容进行总结：',
        },
        {
          ...message,
          content: message.content,
          role: 'assistant',
          name: undefined,
          tool_call_id: undefined,
        },
      ] as UIChatMessage[],
      message.id,
    );
  },

  triggerToolCalls: async (
    assistantId,
    {
      contextExportCaptureId,
      expectedConversationVersion,
      threadId,
      inPortalThread,
      inSearchWorkflow,
    } = {},
  ) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const invocationGeneration = get().conversationClearGeneration;
    const assistantResource = resolvePluginMessageResource(get(), assistantId);
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, assistantResource) &&
      get().conversationClearGeneration === invocationGeneration &&
      isPluginMessageResourceActive(get(), assistantResource);
    if (!assistantResource || !invocationIsCurrent()) return;
    const message = assistantResource.message;
    if (!message.tools) return;
    const resolvedConversationVersion =
      expectedConversationVersion ?? (await messageService.getConversationVersion());
    if (!invocationIsCurrent()) return;

    const { cacheContinuationEnabled, toolLifecycleEnabled } =
      await toolTelemetryService.getCapabilities();
    if (!invocationIsCurrent()) return;

    const collectToolCorrelation = cacheContinuationEnabled || toolLifecycleEnabled;
    const toolCorrelation: ToolCacheDebugMetadata | undefined = collectToolCorrelation
      ? {
          ...createToolCallSetCorrelation(message.tools.map((tool) => tool.id)),
          batchId: `tb_${nanoid(20)}`,
          continuationId: `tc_${nanoid(20)}`,
        }
      : undefined;
    if (toolLifecycleEnabled && toolCorrelation) {
      void toolTelemetryService.reportToolBatch(toolCorrelation, 'started').catch(() => undefined);
    }

    const messagePools = message.tools.map(async (payload): Promise<ToolBatchExecutionResult> => {
      const diagnosticId = toolLifecycleEnabled ? `td_${nanoid(20)}` : undefined;
      const runtimeType = toolLifecycleEnabled
        ? resolveToolDiagnosticRuntimeType(payload)
        : undefined;
      if (!invocationIsCurrent()) {
        return {
          data: undefined,
          diagnosticId,
          outcome: 'cancelled',
          payload,
          runtimeType,
        };
      }

      const toolMessage: CreateMessageParams = {
        content: '',
        parentId: assistantId,
        plugin: payload,
        role: 'tool',
        sessionId: assistantResource.sessionId,
        tool_call_id: payload.id,
        threadId,
        topicId: assistantResource.topicId,
        groupId: message.groupId, // Propagate groupId from parent message for group chat
      };

      const id = await get().internal_createMessage(toolMessage, {
        expectedConversationVersion: resolvedConversationVersion,
      });
      if (!invocationIsCurrent()) {
        return {
          data: undefined,
          diagnosticId,
          id,
          outcome: 'cancelled',
          payload,
          runtimeType,
        };
      }

      if (!id) {
        return {
          data: undefined,
          diagnosticId,
          outcome: 'skipped',
          payload,
          runtimeType,
        };
      }

      try {
        const rawInvocationResult = await get().internal_invokeDifferentTypePlugin(
          id,
          payload,
          toolCorrelation,
          diagnosticId,
        );
        if (!invocationIsCurrent()) {
          return {
            data: undefined,
            diagnosticId,
            id,
            outcome: 'cancelled',
            payload,
            runtimeType,
          };
        }

        const invocationResult =
          rawInvocationResult &&
          typeof rawInvocationResult === 'object' &&
          'data' in rawInvocationResult
            ? rawInvocationResult
            : { data: rawInvocationResult };
        const updatedMessage = getPluginMessageById(get(), id);
        const outcome =
          invocationResult.outcome ??
          (updatedMessage?.error || updatedMessage?.pluginError ? 'failed' : 'completed');

        return {
          data: invocationResult.data,
          diagnosticId,
          id,
          outcome,
          payload,
          runtimeType,
          shouldContinue: invocationResult.shouldContinue,
        };
      } catch (error) {
        return {
          data: undefined,
          diagnosticId,
          id,
          outcome: !invocationIsCurrent() || isAbortError(error) ? 'cancelled' : 'failed',
          payload,
          runtimeType,
        };
      }
    });

    const settledResults = await Promise.allSettled(messagePools).finally(async () => {
      if (invocationIsCurrent()) {
        await get().internal_toggleMessageInToolsCalling(false, assistantId);
      }
    });
    if (!invocationIsCurrent()) return;

    const completedResults = settledResults.flatMap((result, index): ToolBatchExecutionResult[] => {
      if (result.status === 'fulfilled') return [result.value];

      const payload = message.tools![index] as ExecutableChatToolPayload;
      return [
        {
          data: undefined,
          diagnosticId: toolLifecycleEnabled ? `td_${nanoid(20)}` : undefined,
          outcome: isAbortError(result.reason) ? 'cancelled' : 'failed',
          payload,
          runtimeType: toolLifecycleEnabled ? resolveToolDiagnosticRuntimeType(payload) : undefined,
        },
      ];
    });
    let settledToolCacheDebug: ToolCacheDebugMetadata | undefined;
    if (toolCorrelation) {
      const successfulOutcomes = new Set<ToolDiagnosticTerminalOutcome>([
        'completed',
        'handed_off',
      ]);
      const resultCount = completedResults.filter(({ outcome }) =>
        successfulOutcomes.has(outcome),
      ).length;
      const failureCount = completedResults.length - resultCount;
      settledToolCacheDebug = {
        ...toolCorrelation,
        failureCount,
        resultCount,
        toolResults: completedResults.map(({ data, payload }) =>
          createToolResultDebugSummary({
            callIdHash: createToolResultDebugSummary(payload.id).valueHash,
            data,
          }),
        ),
      };

      if (toolLifecycleEnabled) {
        completedResults.forEach(({ data, diagnosticId, outcome, payload, runtimeType }) => {
          if (!diagnosticId || !runtimeType || !settledToolCacheDebug) return;

          const callIdHash = createToolResultDebugSummary(payload.id).valueHash;
          void toolTelemetryService
            .reportToolCompletion({
              callIdHash,
              correlation: settledToolCacheDebug,
              diagnosticId,
              outcome,
              result: createToolResultDebugSummary({ callIdHash, data }),
              runtimeType,
              toolNameHash: createToolResultDebugSummary(payload.apiName).valueHash,
            })
            .catch(() => undefined);
        });
        void toolTelemetryService
          .reportToolBatch(settledToolCacheDebug, 'settled')
          .catch(() => undefined);
      }
    }
    const latestCompletedTool = completedResults.findLast(
      ({ data, outcome, payload, shouldContinue }) => {
        const hasResumableOutcome = ['completed', 'handed_off', 'persistence_failed'].includes(
          outcome,
        );
        const shouldResumeModel =
          shouldContinue === true || (shouldContinue !== false && hasResumableOutcome);

        return shouldResumeModel && data && !['markdown', 'standalone'].includes(payload.type);
      },
    );

    // only default type tool calls should trigger AI message
    if (!latestCompletedTool) return;
    if (!invocationIsCurrent()) return;

    const traceId = chatSelectors.getTraceIdByMessageId(latestCompletedTool.id)(get());

    await get().triggerAIMessage({
      contextExportCaptureId,
      expectedConversationVersion: resolvedConversationVersion,
      traceId,
      threadId,
      inPortalThread,
      inSearchWorkflow,
      toolCacheDebug: cacheContinuationEnabled ? settledToolCacheDebug : undefined,
    });
  },
  updatePluginState: async (id, value) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const isCurrentRequest = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource);
    if (!isCurrentRequest()) return;
    const { refreshMessages } = get();

    // optimistic update
    dispatchPluginMessage(get(), messageResource, {
      id,
      type: 'updateMessage',
      value: { pluginState: value },
    });

    await messageService.updateMessagePluginState(id, value);
    if (isCurrentRequest()) {
      if (isPluginMessageResourceActive(get(), messageResource)) {
        await refreshMessages();
      } else {
        await refreshMessages(conversationContext);
      }
    }
  },

  updatePluginArguments: async (id, value, replace = false) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const toolMessageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(toolMessageResource, get());
    const isCurrentRequest = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, toolMessageResource);
    const { refreshMessages } = get();
    const toolMessage = toolMessageResource?.message;
    if (!toolMessage || !toolMessage?.tool_call_id || !isCurrentRequest()) return;

    const assistantResource = toolMessage.parentId
      ? resolvePluginMessageResource(get(), toolMessage.parentId)
      : undefined;
    let assistantMessage = assistantResource?.message;

    const prevArguments = toolMessage?.plugin?.arguments;
    const prevJson = safeParseJSON(prevArguments || '');
    const nextValue = replace ? (value as any) : merge(prevJson || {}, value);
    if (isEqual(prevJson, nextValue)) return;

    // optimistic update
    dispatchPluginMessage(get(), toolMessageResource, {
      id,
      type: 'updateMessagePlugin',
      value: { arguments: JSON.stringify(nextValue) },
    });

    // 同样需要更新 assistantMessage 的 pluginArguments
    if (assistantMessage) {
      dispatchPluginMessage(get(), assistantResource, {
        id: assistantMessage.id,
        type: 'updateMessageTools',
        tool_call_id: toolMessage?.tool_call_id,
        value: { arguments: JSON.stringify(nextValue) },
      });
      assistantMessage = getPluginMessageById(get(), assistantMessage.id);
    }

    const updateAssistantMessage = async () => {
      if (!assistantMessage) return;
      if (!isCurrentRequest()) return;
      await messageService.updateMessage(assistantMessage!.id, {
        tools: assistantMessage?.tools,
      });
    };

    await Promise.all([
      messageService.updateMessagePluginArguments(id, nextValue),
      updateAssistantMessage(),
    ]);

    if (isCurrentRequest()) {
      if (isPluginMessageResourceActive(get(), toolMessageResource)) {
        await refreshMessages();
      } else {
        await refreshMessages(conversationContext);
      }
    }
  },

  internal_addToolToAssistantMessage: async (id, tool) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const assistantResource = resolvePluginMessageResource(get(), id);
    const assistantMessage = assistantResource?.message;
    if (!assistantMessage) return;

    const { internal_refreshToUpdateMessageTools } = get();
    dispatchPluginMessage(get(), assistantResource, {
      type: 'addMessageTool',
      value: tool,
      id: assistantMessage.id,
    });

    await internal_refreshToUpdateMessageTools(id);
  },

  internal_removeToolToAssistantMessage: async (id, tool_call_id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const message = messageResource?.message;
    if (!message || !tool_call_id) return;

    const { internal_refreshToUpdateMessageTools } = get();

    // optimistic update
    dispatchPluginMessage(get(), messageResource, {
      type: 'deleteMessageTool',
      tool_call_id,
      id: message.id,
    });

    // update the message tools
    await internal_refreshToUpdateMessageTools(id);
  },
  internal_refreshToUpdateMessageTools: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const isCurrentRequest = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource);
    const message = messageResource?.message;
    if (!message || !message.tools || !isCurrentRequest()) return;

    const { internal_toggleMessageLoading, refreshMessages } = get();

    internal_toggleMessageLoading(true, id);
    await messageService.updateMessage(id, { tools: message.tools });
    if (!isCurrentRequest()) return;
    internal_toggleMessageLoading(false, id);

    if (isPluginMessageResourceActive(get(), messageResource)) {
      await refreshMessages();
    } else {
      await refreshMessages(conversationContext);
    }
  },

  internal_callPluginApi: async (id, payload) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const { internal_updateMessageContent, refreshMessages, internal_togglePluginApiCalling } =
      get();
    let data: string;
    let abortController: AbortController | undefined;
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource) &&
      !abortController?.signal.aborted;

    try {
      abortController = internal_togglePluginApiCalling(true, id, n('fetchPlugin/start') as string);

      const message = messageResource?.message;

      const res = await chatService.runPluginApi(payload, {
        signal: abortController?.signal,
        trace: { observationId: message?.observationId, traceId: message?.traceId },
      });
      if (!invocationIsCurrent()) return;
      data = res.text;

      // save traceId
      if (res.traceId) {
        await messageService.updateMessage(id, { traceId: res.traceId });
        if (!invocationIsCurrent()) return;
      }
    } catch (error) {
      if (!invocationIsCurrent()) return;
      console.log(error);
      const err = error as Error;

      // ignore the aborted request error
      if (!err.message.includes('The user aborted a request.')) {
        await messageService.updateMessageError(id, error as any);
        if (invocationIsCurrent()) {
          if (isPluginMessageResourceActive(get(), messageResource)) {
            await refreshMessages();
          } else {
            await refreshMessages(conversationContext);
          }
        }
      }

      data = '';
    } finally {
      if (invocationIsCurrent()) {
        if (abortController) {
          internal_togglePluginApiCalling(
            false,
            id,
            n('fetchPlugin/end') as string,
            abortController,
          );
        } else {
          internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string);
        }
      }
    }

    // 如果报错则结束了
    if (!data || !invocationIsCurrent()) return;

    if (conversationContext && !isPluginMessageResourceActive(get(), messageResource)) {
      await internal_updateMessageContent(id, data, { conversationContext });
    } else {
      await internal_updateMessageContent(id, data);
    }

    return data;
  },

  internal_invokeDifferentTypePlugin: async (id, payload, toolCacheDebug, diagnosticId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) {
      return { data: undefined, outcome: 'cancelled', shouldContinue: false };
    }

    if (payload.identifier === LOBE_PROVIDER_BUILTIN_IDENTIFIER) {
      const data = await get().invokeProviderBuiltinTool(id, payload);
      return { data, outcome: 'handed_off' };
    }

    switch (payload.type) {
      case 'standalone': {
        const data = await get().invokeStandaloneTypePlugin(id, payload);
        return { data };
      }

      case 'markdown': {
        const data = await get().invokeMarkdownTypePlugin(id, payload);
        return { data };
      }

      case 'builtin': {
        const invocationResult = await get().invokeBuiltinTool(id, payload, diagnosticId);
        if (
          invocationResult &&
          typeof invocationResult === 'object' &&
          'data' in invocationResult &&
          'outcome' in invocationResult
        ) {
          return invocationResult;
        }

        const updatedMessage = getPluginMessageById(get(), id);
        const diagnosticError = updatedMessage?.error ?? updatedMessage?.pluginError;

        return {
          data: diagnosticError ?? updatedMessage?.content,
          outcome: diagnosticError
            ? 'failed'
            : invocationResult === undefined
              ? 'skipped'
              : 'completed',
          shouldContinue: invocationResult === true,
        };
      }

      case 'mcp': {
        return await get().invokeMCPTypePlugin(id, payload, toolCacheDebug, diagnosticId);
      }

      default: {
        const data = await get().invokeDefaultTypePlugin(id, payload);
        return { data };
      }
    }
  },
  invokeMCPTypePlugin: async (id, payload, toolCacheDebug, requestedDiagnosticId) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) {
      return { data: undefined, outcome: 'cancelled', shouldContinue: false };
    }

    const messageResource = resolvePluginMessageResource(get(), id);
    const { internal_togglePluginApiCalling, internal_constructToolsCallingContext } = get();
    let data: string = '';
    const diagnosticId = requestedDiagnosticId || `td_${nanoid(20)}`;
    const abortController = internal_togglePluginApiCalling(
      true,
      id,
      n('fetchPlugin/start') as string,
    );
    const invocationIsCurrent = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource) &&
      !abortController?.signal.aborted;

    const reportMessagePersistenceFailure = (error: unknown) => {
      const responseError = findRPCResponseError(error);
      if (!responseError) return false;

      mcpService.reportClientRPCFailure(responseError.details, {
        attempt: 1,
        diagnosticId,
        operation: 'persist_tool_result',
        procedure: 'message.update',
        rpcEndpoint: 'lambda',
      });
      return true;
    };

    try {
      const context = internal_constructToolsCallingContext(id);
      const result = await mcpService.invokeMcpToolCall(payload, {
        diagnosticId,
        messageId: id,
        signal: abortController?.signal,
        toolCacheDebug,
        topicId: context?.topicId,
      });

      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      if (!result) return { data: undefined, outcome: 'skipped' };

      data = result.content;

      if (!data) return { data: undefined, outcome: 'skipped' };

      switch (result.persistence) {
        case 'persisted': {
          if (!invocationIsCurrent()) {
            return { data: undefined, outcome: 'cancelled', shouldContinue: false };
          }
          dispatchPluginMessage(get(), messageResource, {
            id,
            type: 'updateMessage',
            value: { content: data },
          });
          return { data };
        }

        case 'superseded': {
          return { data: undefined, outcome: 'cancelled', shouldContinue: false };
        }

        case 'failed': {
          if (!invocationIsCurrent()) {
            return { data: undefined, outcome: 'cancelled', shouldContinue: false };
          }
          dispatchPluginMessage(get(), messageResource, {
            id,
            type: 'updateMessage',
            value: { content: data },
          });
          const { notification } = await import('@/components/AntdStaticMethods');
          notification.warning({
            description: t('mcpResultPersistence.description', { ns: 'error' }),
            message: t('mcpResultPersistence.title', { ns: 'error' }),
          });
          return { data, outcome: 'persistence_failed' };
        }
      }
    } catch (error) {
      const wasCancelled = !invocationIsCurrent() || isAbortError(error);
      if (!wasCancelled) {
        const messageError = createMCPChatMessageError(error, (type) =>
          t(`response.${type}`, { ns: 'error' }),
        );
        dispatchPluginMessage(get(), messageResource, {
          id,
          type: 'updateMessage',
          value: { error: messageError },
        });

        try {
          await messageService.updateMessage(
            id,
            { error: messageError },
            {
              diagnosticId,
              diagnosticOperation: 'persist_tool_result',
              showNotification: false,
            },
          );
        } catch (persistenceError) {
          reportMessagePersistenceFailure(persistenceError);
        }
      }
      return {
        data: undefined,
        outcome: wasCancelled ? 'cancelled' : 'failed',
      };
    } finally {
      if (invocationIsCurrent()) {
        internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string, abortController);
      }
    }
  },

  internal_togglePluginApiCalling: (loading, id, action, expectedAbortController) => {
    if (loading) {
      if (!id) return;

      window.addEventListener('beforeunload', preventLeavingFn);
      get().pluginApiAbortControllers[id]?.abort();

      const abortController = new AbortController();
      set(
        {
          pluginApiAbortControllers: {
            ...get().pluginApiAbortControllers,
            [id]: abortController,
          },
          pluginApiLoadingIds: toggleBooleanList(get().pluginApiLoadingIds, id, true),
        },
        false,
        action,
      );

      return abortController;
    }

    if (!id) {
      set({ pluginApiAbortControllers: {}, pluginApiLoadingIds: [] }, false, action);
      window.removeEventListener('beforeunload', preventLeavingFn);
      return;
    }

    const activeAbortController = get().pluginApiAbortControllers[id];
    if (expectedAbortController && activeAbortController !== expectedAbortController) {
      return activeAbortController;
    }

    const pluginApiAbortControllers = { ...get().pluginApiAbortControllers };
    delete pluginApiAbortControllers[id];
    const pluginApiLoadingIds = toggleBooleanList(get().pluginApiLoadingIds, id, false);
    set({ pluginApiAbortControllers, pluginApiLoadingIds }, false, action);

    if (pluginApiLoadingIds.length === 0) {
      window.removeEventListener('beforeunload', preventLeavingFn);
    }
  },

  internal_transformToolCalls: (toolCalls) => {
    const toolNameResolver = new ToolNameResolver();

    // Build manifests map from tool store
    const toolStoreState = useToolStore.getState();
    const manifests: Record<string, LobeChatPluginManifest> = {};

    // Get all installed plugins
    const installedPlugins = pluginSelectors.installedPlugins(toolStoreState);
    for (const plugin of installedPlugins) {
      if (plugin.manifest) {
        manifests[plugin.identifier] = plugin.manifest as LobeChatPluginManifest;
      }
    }

    // Get all builtin tools
    for (const tool of builtinTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as LobeChatPluginManifest;
      }
    }

    return toolNameResolver.resolve(toolCalls, manifests);
  },
  internal_updatePluginError: async (id, error) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const messageResource = resolvePluginMessageResource(get(), id);
    const conversationContext = createResourceConversationContext(messageResource, get());
    const isCurrentRequest = () =>
      isPluginMutationCurrent(get(), accountMutationSnapshot, messageResource);
    if (!isCurrentRequest()) return;
    const { refreshMessages } = get();

    dispatchPluginMessage(get(), messageResource, {
      id,
      type: 'updateMessage',
      value: { error },
    });
    await messageService.updateMessage(id, { error });
    if (isCurrentRequest()) {
      if (isPluginMessageResourceActive(get(), messageResource)) {
        await refreshMessages();
      } else {
        await refreshMessages(conversationContext);
      }
    }
  },

  internal_constructToolsCallingContext: (id: string) => {
    const messageResource = resolvePluginMessageResource(get(), id);
    if (!messageResource) return;

    return {
      topicId: messageResource.topicId,
    };
  },
});
