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
import { ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
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
    const newMessage: CreateMessageParams = {
      content,
      parentId,
      role: 'assistant',
      sessionId: get().activeId,
      topicId: get().activeTopicId, // if there is activeTopicId，then add it to topicId
    };

    await messageService.createMessage(newMessage);
    await get().refreshMessages();
  },

  fillPluginMessageContent: async (id, content, triggerAiMessage) => {
    const { triggerAIMessage, internal_updateMessageContent } = get();

    await internal_updateMessageContent(id, content);

    if (triggerAiMessage) await triggerAIMessage({ parentId: id });
  },
  invokeBuiltinTool: async (id, payload, diagnosticId) => {
    const {
      internal_togglePluginApiCalling,
      internal_updateMessageContent,
      internal_updatePluginError,
    } = get();
    const params = JSON.parse(payload.arguments);
    internal_togglePluginApiCalling(true, id, n('invokeBuiltinTool/start') as string);
    let data;
    try {
      data = await useToolStore.getState().transformApiArgumentsToAiState(payload.apiName, params);
    } catch (error) {
      const err = error as Error;
      console.error(err);

      const tool = builtinTools.find((tool) => tool.identifier === payload.identifier);
      const schema = tool?.manifest?.api.find((api) => api.name === payload.apiName)?.parameters;

      await internal_updatePluginError(id, {
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
    internal_togglePluginApiCalling(false, id, n('invokeBuiltinTool/end') as string);

    if (!data) {
      return {
        data: undefined,
        outcome: 'skipped',
        shouldContinue: false,
      };
    }

    await internal_updateMessageContent(id, data);

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
    if (
      actionResult &&
      typeof actionResult === 'object' &&
      'data' in actionResult &&
      'outcome' in actionResult
    ) {
      return actionResult as ToolInvocationResult;
    }

    const updatedMessage = chatSelectors.getMessageById(id)(get());
    const diagnosticError = updatedMessage?.error ?? updatedMessage?.pluginError;

    return {
      data: diagnosticError ?? updatedMessage?.content,
      outcome: diagnosticError ? 'failed' : actionResult === undefined ? 'skipped' : 'completed',
      shouldContinue: actionResult === true,
    };
  },

  invokeProviderBuiltinTool: async (id, payload) => {
    const { internal_updateMessageContent } = get();
    // Kimi / Moonshot `$web_search`: submit `tool_call.function.arguments` verbatim as the
    // tool message content so the next completion can run search (see Moonshot docs).
    const content =
      typeof payload.arguments === 'string' && payload.arguments.trim().length > 0
        ? payload.arguments
        : '{}';
    await internal_updateMessageContent(id, content);
    return content;
  },

  invokeDefaultTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  },

  invokeMarkdownTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    await internal_callPluginApi(id, payload);
  },

  invokeStandaloneTypePlugin: async (id, payload) => {
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result) return;

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

      await get().refreshMessages();
      return;
    }
  },

  reInvokeToolMessage: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      get().internal_updateMessagePluginError(id, null);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await get().internal_invokeDifferentTypePlugin(id, payload);
  },

  triggerAIMessage: async ({
    parentId,
    traceId,
    threadId,
    inPortalThread,
    inSearchWorkflow,
    toolCacheDebug,
  }) => {
    const { internal_coreProcessMessage } = get();

    // Pass the complete conversation to the shared context-engine truncation.
    // Pre-slicing here makes automatic tool continuations use a different
    // history boundary than the user request that produced the tool calls,
    // which breaks byte-identical prompt-cache prefixes.
    const chats = inPortalThread
      ? threadSelectors.portalAIChats(get())
      : chatSelectors.mainAIChats(get());

    await internal_coreProcessMessage(chats, parentId ?? chats.at(-1)!.id, {
      traceId,
      threadId,
      inPortalThread,
      inSearchWorkflow,
      isToolContinuation: true,
      toolCacheDebug,
    });
  },

  summaryPluginContent: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
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

  triggerToolCalls: async (assistantId, { threadId, inPortalThread, inSearchWorkflow } = {}) => {
    const message = chatSelectors.getMessageById(assistantId)(get());
    if (!message || !message.tools) return;

    const { cacheContinuationEnabled, toolLifecycleEnabled } =
      await toolTelemetryService.getCapabilities();
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
      const toolMessage: CreateMessageParams = {
        content: '',
        parentId: assistantId,
        plugin: payload,
        role: 'tool',
        sessionId: get().activeId,
        tool_call_id: payload.id,
        threadId,
        topicId: get().activeTopicId, // if there is activeTopicId，then add it to topicId
        groupId: message.groupId, // Propagate groupId from parent message for group chat
      };

      const id = await get().internal_createMessage(toolMessage);
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
        const invocationResult =
          rawInvocationResult &&
          typeof rawInvocationResult === 'object' &&
          'data' in rawInvocationResult
            ? rawInvocationResult
            : { data: rawInvocationResult };
        const updatedMessage = chatSelectors.getMessageById(id)(get());
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
          outcome: isAbortError(error) ? 'cancelled' : 'failed',
          payload,
          runtimeType,
        };
      }
    });

    const settledResults = await Promise.allSettled(messagePools).finally(async () => {
      await get().internal_toggleMessageInToolsCalling(false, assistantId);
    });
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

    const traceId = chatSelectors.getTraceIdByMessageId(latestCompletedTool.id)(get());

    await get().triggerAIMessage({
      traceId,
      threadId,
      inPortalThread,
      inSearchWorkflow,
      toolCacheDebug: cacheContinuationEnabled ? settledToolCacheDebug : undefined,
    });
  },
  updatePluginState: async (id, value) => {
    const { refreshMessages } = get();

    // optimistic update
    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { pluginState: value } });

    await messageService.updateMessagePluginState(id, value);
    await refreshMessages();
  },

  updatePluginArguments: async (id, value, replace = false) => {
    const { refreshMessages } = get();
    const toolMessage = chatSelectors.getMessageById(id)(get());
    if (!toolMessage || !toolMessage?.tool_call_id) return;

    let assistantMessage = chatSelectors.getMessageById(toolMessage?.parentId || '')(get());

    const prevArguments = toolMessage?.plugin?.arguments;
    const prevJson = safeParseJSON(prevArguments || '');
    const nextValue = replace ? (value as any) : merge(prevJson || {}, value);
    if (isEqual(prevJson, nextValue)) return;

    // optimistic update
    get().internal_dispatchMessage({
      id,
      type: 'updateMessagePlugin',
      value: { arguments: JSON.stringify(nextValue) },
    });

    // 同样需要更新 assistantMessage 的 pluginArguments
    if (assistantMessage) {
      get().internal_dispatchMessage({
        id: assistantMessage.id,
        type: 'updateMessageTools',
        tool_call_id: toolMessage?.tool_call_id,
        value: { arguments: JSON.stringify(nextValue) },
      });
      assistantMessage = chatSelectors.getMessageById(assistantMessage?.id)(get());
    }

    const updateAssistantMessage = async () => {
      if (!assistantMessage) return;
      await messageService.updateMessage(assistantMessage!.id, {
        tools: assistantMessage?.tools,
      });
    };

    await Promise.all([
      messageService.updateMessagePluginArguments(id, nextValue),
      updateAssistantMessage(),
    ]);

    await refreshMessages();
  },

  internal_addToolToAssistantMessage: async (id, tool) => {
    const assistantMessage = chatSelectors.getMessageById(id)(get());
    if (!assistantMessage) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();
    internal_dispatchMessage({
      type: 'addMessageTool',
      value: tool,
      id: assistantMessage.id,
    });

    await internal_refreshToUpdateMessageTools(id);
  },

  internal_removeToolToAssistantMessage: async (id, tool_call_id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !tool_call_id) return;

    const { internal_dispatchMessage, internal_refreshToUpdateMessageTools } = get();

    // optimistic update
    internal_dispatchMessage({ type: 'deleteMessageTool', tool_call_id, id: message.id });

    // update the message tools
    await internal_refreshToUpdateMessageTools(id);
  },
  internal_refreshToUpdateMessageTools: async (id) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !message.tools) return;

    const { internal_toggleMessageLoading, refreshMessages } = get();

    internal_toggleMessageLoading(true, id);
    await messageService.updateMessage(id, { tools: message.tools });
    internal_toggleMessageLoading(false, id);

    await refreshMessages();
  },

  internal_callPluginApi: async (id, payload) => {
    const { internal_updateMessageContent, refreshMessages, internal_togglePluginApiCalling } =
      get();
    let data: string;

    try {
      const abortController = internal_togglePluginApiCalling(
        true,
        id,
        n('fetchPlugin/start') as string,
      );

      const message = chatSelectors.getMessageById(id)(get());

      const res = await chatService.runPluginApi(payload, {
        signal: abortController?.signal,
        trace: { observationId: message?.observationId, traceId: message?.traceId },
      });
      data = res.text;

      // save traceId
      if (res.traceId) {
        await messageService.updateMessage(id, { traceId: res.traceId });
      }
    } catch (error) {
      console.log(error);
      const err = error as Error;

      // ignore the aborted request error
      if (!err.message.includes('The user aborted a request.')) {
        await messageService.updateMessageError(id, error as any);
        await refreshMessages();
      }

      data = '';
    }

    internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string);
    // 如果报错则结束了
    if (!data) return;

    await internal_updateMessageContent(id, data);

    return data;
  },

  internal_invokeDifferentTypePlugin: async (id, payload, toolCacheDebug, diagnosticId) => {
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

        const updatedMessage = chatSelectors.getMessageById(id)(get());
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
    const {
      internal_dispatchMessage,
      internal_updateMessageContent,
      internal_togglePluginApiCalling,
      internal_constructToolsCallingContext,
    } = get();
    let data: string = '';
    const diagnosticId = requestedDiagnosticId || `td_${nanoid(20)}`;
    const abortController = internal_togglePluginApiCalling(
      true,
      id,
      n('fetchPlugin/start') as string,
    );

    const reportPersistenceFailure = (error: unknown, attempt: number) => {
      const responseError = findRPCResponseError(error);
      if (!responseError) return false;

      mcpService.reportClientRPCFailure(responseError.details, {
        attempt,
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

      if (!!result) data = result.content;

      if (!data) return { data: undefined, outcome: 'skipped' };

      if (result?.persistence === 'persisted') {
        internal_dispatchMessage({ id, type: 'updateMessage', value: { content: data } });
        return { data };
      }

      if (result?.persistence === 'failed') {
        internal_dispatchMessage({ id, type: 'updateMessage', value: { content: data } });
        const { notification } = await import('@/components/AntdStaticMethods');
        notification.warning({
          description: t('mcpResultPersistence.description', { ns: 'error' }),
          message: t('mcpResultPersistence.title', { ns: 'error' }),
        });
        return { data, outcome: 'persistence_failed' };
      }

      let persisted = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await internal_updateMessageContent(id, data, {
            diagnosticId,
            showNotification: false,
            skipRefresh: true,
          });
          persisted = true;
          break;
        } catch (error) {
          const classified = reportPersistenceFailure(error, attempt);
          if (!classified || attempt === 2) break;
        }
      }

      if (!persisted) {
        const { notification } = await import('@/components/AntdStaticMethods');
        notification.warning({
          description: t('mcpResultPersistence.description', { ns: 'error' }),
          message: t('mcpResultPersistence.title', { ns: 'error' }),
        });
      }

      // The valid result remains in the optimistic store even if the proxy prevented
      // ChatHub from confirming persistence. Continue the model turn in that case.
      return { data, outcome: persisted ? 'completed' : 'persistence_failed' };
    } catch (error) {
      // ignore the aborted request error
      if (!isAbortError(error)) {
        const messageError = createMCPChatMessageError(error, (type) =>
          t(`response.${type}`, { ns: 'error' }),
        );
        internal_dispatchMessage({ id, type: 'updateMessage', value: { error: messageError } });

        try {
          await messageService.updateMessage(
            id,
            { error: messageError },
            {
              diagnosticId,
              showNotification: false,
            },
          );
        } catch (persistenceError) {
          reportPersistenceFailure(persistenceError, 1);
        }
      }
      return {
        data: undefined,
        outcome: isAbortError(error) ? 'cancelled' : 'failed',
      };
    } finally {
      internal_togglePluginApiCalling(false, id, n('fetchPlugin/end') as string);
    }
  },

  internal_togglePluginApiCalling: (loading, id, action) => {
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
    const { refreshMessages } = get();

    get().internal_dispatchMessage({ id, type: 'updateMessage', value: { error } });
    await messageService.updateMessage(id, { error });
    await refreshMessages();
  },

  internal_constructToolsCallingContext: (id: string) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    return {
      topicId: message.topicId,
    };
  },
});
