import { ChatToolPayload, UIChatMessage, createToolResultDebugSummary } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as generationDebugClient from '@/libs/logger/generationDebugClient';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { toolTelemetryService } from '@/services/toolTelemetry';
import { chatSelectors, threadSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('@/components/AntdStaticMethods', () => ({
  notification: { warning: vi.fn() },
}));

const initialState = useChatStore.getInitialState();

const createDeferred = <Result>() => {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

describe('MCP tool-result persistence recovery', () => {
  const payload = {
    apiName: 'tavily_search',
    arguments: '{"query":"test"}',
    identifier: 'tavily',
    type: 'mcp',
  } as ChatToolPayload;

  beforeEach(() => {
    useChatStore.setState(initialState, true);
    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [
          { content: '', id: 'message-id', role: 'tool' } as UIChatMessage,
        ],
      },
    });
    vi.spyOn(toolTelemetryService, 'getCapabilities').mockResolvedValue({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: true,
    });
    vi.spyOn(messageService, 'getConversationVersion').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps concurrent MCP abort controllers independent', () => {
    const store = useChatStore.getState();
    const first = store.internal_togglePluginApiCalling(true, 'tool-message-1', 'start');
    const second = store.internal_togglePluginApiCalling(true, 'tool-message-2', 'start');

    expect(useChatStore.getState().pluginApiLoadingIds).toEqual([
      'tool-message-1',
      'tool-message-2',
    ]);
    expect(useChatStore.getState().pluginApiAbortControllers).toMatchObject({
      'tool-message-1': first,
      'tool-message-2': second,
    });

    store.internal_togglePluginApiCalling(false, 'tool-message-1', 'finish');

    expect(useChatStore.getState().pluginApiLoadingIds).toEqual(['tool-message-2']);
    expect(useChatStore.getState().pluginApiAbortControllers).toEqual({
      'tool-message-2': second,
    });
    expect(second?.signal.aborted).toBe(false);

    store.internal_togglePluginApiCalling(false, 'tool-message-2', 'finish');
  });

  it('keeps a newer invocation active when an older invocation finishes', () => {
    const store = useChatStore.getState();
    const first = store.internal_togglePluginApiCalling(true, 'tool-message', 'first-start');
    const second = store.internal_togglePluginApiCalling(true, 'tool-message', 'second-start');

    expect(first?.signal.aborted).toBe(true);
    expect(second?.signal.aborted).toBe(false);

    store.internal_togglePluginApiCalling(false, 'tool-message', 'first-finish', first);

    expect(useChatStore.getState().pluginApiLoadingIds).toEqual(['tool-message']);
    expect(useChatStore.getState().pluginApiAbortControllers).toEqual({
      'tool-message': second,
    });

    store.internal_togglePluginApiCalling(false, 'tool-message', 'second-finish', second);

    expect(useChatStore.getState().pluginApiLoadingIds).toEqual([]);
    expect(useChatStore.getState().pluginApiAbortControllers).toEqual({});
  });

  it('does not persist an aborted WebKit Load failed error', async () => {
    const abortController = new AbortController();
    const dispatchMessage = vi.fn();
    const updateMessageContent = vi.fn();
    const updateMessage = vi.spyOn(messageService, 'updateMessage');
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockImplementation(async () => {
      abortController.abort();
      throw new TypeError('Load failed');
    });

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_dispatchMessage: dispatchMessage,
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(abortController),
      internal_updateMessageContent: updateMessageContent,
    });

    await expect(
      useChatStore.getState().invokeMCPTypePlugin('message-id', payload),
    ).resolves.toEqual({
      data: undefined,
      outcome: 'cancelled',
    });

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(updateMessageContent).not.toHaveBeenCalled();
    expect(updateMessage).not.toHaveBeenCalled();
  });

  it('uses a server-persisted result and preserves the requested diagnostic ID', async () => {
    const requestedDiagnosticId = 'td_requesteddiagnostic';
    const toolResult = '{"results":[{"title":"persisted"}]}';
    const dispatchMessage = vi.fn();
    const updateMessageContent = vi.fn();
    const invokeTool = vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue({
      content: toolResult,
      persistence: 'persisted',
    });

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_dispatchMessage: dispatchMessage,
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(new AbortController()),
      internal_updateMessageContent: updateMessageContent,
    });

    const response = await useChatStore
      .getState()
      .invokeMCPTypePlugin('message-id', payload, undefined, requestedDiagnosticId);

    expect(response).toEqual({ data: toolResult });
    expect(invokeTool).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        diagnosticId: requestedDiagnosticId,
        messageId: 'message-id',
        topicId: 'topic-id',
      }),
    );
    expect(dispatchMessage).toHaveBeenCalledWith({
      id: 'message-id',
      type: 'updateMessage',
      value: { content: toolResult },
    });
    expect(updateMessageContent).not.toHaveBeenCalled();
  });

  it('continues optimistically without reposting when server persistence fails', async () => {
    const toolResult = '{"results":[{"title":"in-memory"}]}';
    const dispatchMessage = vi.fn();
    const updateMessageContent = vi.fn();
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue({
      content: toolResult,
      persistence: 'failed',
    });

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_dispatchMessage: dispatchMessage,
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(new AbortController()),
      internal_updateMessageContent: updateMessageContent,
    });

    await expect(
      useChatStore.getState().invokeMCPTypePlugin('message-id', payload),
    ).resolves.toEqual({
      data: toolResult,
      outcome: 'persistence_failed',
    });

    expect(dispatchMessage).toHaveBeenCalledTimes(1);
    expect(updateMessageContent).not.toHaveBeenCalled();
    const { notification } = await import('@/components/AntdStaticMethods');
    expect(notification.warning).toHaveBeenCalledTimes(1);
  });

  it('passes the complete main conversation to context engineering for a tool continuation', async () => {
    const chats = [
      { content: 'Old question', id: 'old-user', role: 'user' },
      { content: 'Old answer', id: 'old-assistant', role: 'assistant' },
      { content: 'Search', id: 'latest-user', role: 'user' },
      { content: 'Result', id: 'tool-result', role: 'tool' },
    ] as UIChatMessage[];
    const coreProcessMessage = vi.fn();
    vi.spyOn(chatSelectors, 'mainAIChats').mockReturnValue(chats);
    const preSlicedSelector = vi.spyOn(chatSelectors, 'mainAIChatsWithHistoryConfig');
    useChatStore.setState({ internal_coreProcessMessage: coreProcessMessage });

    await useChatStore.getState().triggerAIMessage({ traceId: 'trace-id' });

    expect(preSlicedSelector).not.toHaveBeenCalled();
    expect(coreProcessMessage).toHaveBeenCalledWith(chats, 'tool-result', {
      conversationContext: undefined,
      contextExportCaptureId: undefined,
      expectedConversationVersion: undefined,
      inPortalThread: undefined,
      inSearchWorkflow: undefined,
      isToolContinuation: true,
      threadId: undefined,
      toolCacheDebug: undefined,
      traceId: 'trace-id',
    });
  });

  it('passes the complete portal conversation to context engineering for a tool continuation', async () => {
    const chats = [
      { content: 'Thread question', id: 'thread-user', role: 'user' },
      { content: 'Thread result', id: 'thread-tool', role: 'tool' },
    ] as UIChatMessage[];
    const coreProcessMessage = vi.fn();
    vi.spyOn(threadSelectors, 'portalAIChats').mockReturnValue(chats);
    const preSlicedSelector = vi.spyOn(threadSelectors, 'portalAIChatsWithHistoryConfig');
    useChatStore.setState({ internal_coreProcessMessage: coreProcessMessage });

    await useChatStore.getState().triggerAIMessage({
      inPortalThread: true,
      threadId: 'thread-id',
      traceId: 'trace-id',
    });

    expect(preSlicedSelector).not.toHaveBeenCalled();
    expect(coreProcessMessage).toHaveBeenCalledWith(chats, 'thread-tool', {
      conversationContext: undefined,
      contextExportCaptureId: undefined,
      expectedConversationVersion: undefined,
      inPortalThread: true,
      inSearchWorkflow: undefined,
      isToolContinuation: true,
      threadId: 'thread-id',
      toolCacheDebug: undefined,
      traceId: 'trace-id',
    });
  });

  it('preserves exact session and topic IDs when creating a tool message', async () => {
    const sessionId = 'ssn_KbcUulFch0XW';
    const topicId = 'tpc_sFEpZTp0eROJ';
    const assistantId = 'assistant-with-map-context';
    const toolMessageId = 'tool-message-with-map-context';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"test"}',
      id: 'tool-call-with-map-context',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const createMessage = vi.fn().mockResolvedValue(toolMessageId);

    useChatStore.setState({
      activeId: sessionId,
      activeTopicId: topicId,
      internal_createMessage: createMessage,
      internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
        data: '{"ok":true}',
        outcome: 'completed',
        shouldContinue: false,
      }),
      internal_toggleMessageInToolsCalling: vi.fn().mockResolvedValue(undefined),
      messagesMap: {
        [messageMapKey(sessionId, topicId)]: [assistantMessage],
      },
      triggerAIMessage: vi.fn(),
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: assistantId,
        sessionId,
        topicId,
      }),
      {
        expectedConversationVersion: undefined,
      },
    );
    expect(createMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: `${sessionId}_tpc`,
      }),
      expect.anything(),
    );
  });

  it('settles parallel tools and continues once when one tool rejects', async () => {
    const assistantId = 'assistant-id';
    const message = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [
        {
          apiName: 'first',
          arguments: '{}',
          id: 'tool-1',
          identifier: 'tavily',
          type: 'mcp',
        },
        {
          apiName: 'second',
          arguments: '{}',
          id: 'tool-2',
          identifier: 'tavily',
          type: 'mcp',
        },
      ],
    } as UIChatMessage;
    const invokeTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('first tool failed'))
      .mockResolvedValueOnce('{"ok":true}');
    const triggerAIMessage = vi.fn();
    const toggleToolsCalling = vi.fn().mockResolvedValue(undefined);
    let resolveTelemetry!: (value: { reported: boolean }) => void;
    const pendingTelemetry = new Promise<{ reported: boolean }>((resolve) => {
      resolveTelemetry = resolve;
    });
    const reportToolCompletion = vi
      .spyOn(toolTelemetryService, 'reportToolCompletion')
      .mockReturnValue(pendingTelemetry);
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_createMessage: vi
        .fn()
        .mockResolvedValueOnce('tool-message-1')
        .mockResolvedValueOnce('tool-message-2'),
      internal_invokeDifferentTypePlugin: invokeTool,
      internal_toggleMessageInToolsCalling: toggleToolsCalling,
      messagesMap: { [messageMapKey('session-id', 'topic-id')]: [message] },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(invokeTool).toHaveBeenCalledTimes(2);
    expect(toggleToolsCalling).toHaveBeenCalledWith(false, assistantId);
    expect(triggerAIMessage).toHaveBeenCalledTimes(1);
    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: 'tool-message-2',
        traceId: 'trace-id',
      }),
    );
    expect(reportToolCompletion).toHaveBeenCalledTimes(2);
    expect(reportToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        correlation: expect.objectContaining({
          failureCount: 1,
          resultCount: 1,
          toolCallCount: 2,
          toolCallSetHash: expect.stringMatching(/^[\da-f]{16}$/),
        }),
        diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
        outcome: 'failed',
        runtimeType: 'mcp',
        toolNameHash: expect.stringMatching(/^[\da-f]{16}$/),
      }),
    );
    expect(reportToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'completed',
        runtimeType: 'mcp',
      }),
    );

    resolveTelemetry({ reported: true });
    await pendingTelemetry;
  });

  it('does not continue a tool batch that completes after conversation history is cleared', async () => {
    const assistantId = 'assistant-cleared';
    const toolMessageId = 'tool-message-cleared';
    const toolPayload = {
      apiName: 'python',
      arguments: '{"code":"print(1)"}',
      id: 'tool-cleared',
      identifier: 'builtin',
      type: 'builtin',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const deferredInvocation = createDeferred<{
      data: string;
      outcome: 'completed';
      shouldContinue: true;
    }>();
    const invokeTool = vi.fn().mockReturnValue(deferredInvocation.promise);
    const toggleToolsCalling = vi.fn().mockResolvedValue(undefined);
    const triggerAIMessage = vi.fn();

    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      conversationClearGeneration: 0,
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: invokeTool,
      internal_toggleMessageInToolsCalling: toggleToolsCalling,
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage],
      },
      triggerAIMessage,
    });

    const toolBatchPromise = useChatStore.getState().triggerToolCalls(assistantId);
    await vi.waitFor(() => {
      expect(invokeTool).toHaveBeenCalledOnce();
    });

    useChatStore.setState((state) => ({
      conversationClearGeneration: state.conversationClearGeneration + 1,
      messagesMap: {},
    }));
    deferredInvocation.resolve({
      data: '{"stdout":"stale"}',
      outcome: 'completed',
      shouldContinue: true,
    });

    await toolBatchPromise;

    expect(toggleToolsCalling).toHaveBeenCalledWith(false, assistantId);
    expect(triggerAIMessage).not.toHaveBeenCalled();
  });

  it('continues after a handled tool failure explicitly requests continuation', async () => {
    const assistantId = 'assistant-handled-failure';
    const toolMessageId = 'tool-message-handled-failure';
    const toolPayload = {
      apiName: 'search',
      arguments: '{"query":"test"}',
      id: 'tool-handled-failure',
      identifier: 'builtin',
      type: 'builtin',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const toolMessage = {
      content: '{"error":"search temporarily unavailable"}',
      id: toolMessageId,
      parentId: assistantId,
      plugin: toolPayload,
      role: 'tool',
      tool_call_id: toolPayload.id,
    } as UIChatMessage;
    const triggerAIMessage = vi.fn();

    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (messageId) => () => (messageId === assistantId ? assistantMessage : toolMessage),
    );
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: undefined,
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
        data: toolMessage.content,
        outcome: 'failed',
        shouldContinue: true,
      }),
      internal_toggleMessageInToolsCalling: vi.fn().mockResolvedValue(undefined),
      messagesMap: {
        [messageMapKey('session-id', undefined)]: [assistantMessage, toolMessage],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
        }),
        parentId: toolMessageId,
        traceId: 'trace-id',
      }),
    );

    triggerAIMessage.mockClear();
    useChatStore.setState({
      internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
        data: toolMessage.content,
        outcome: 'failed',
      }),
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(triggerAIMessage).not.toHaveBeenCalled();
  });

  it('skips diagnostic metadata and telemetry when server diagnostics are disabled', async () => {
    const assistantId = 'assistant-disabled-diagnostics';
    const toolMessageId = 'tool-message-disabled-diagnostics';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"test"}',
      id: 'tool-disabled-diagnostics',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const toolMessage = {
      content: toolPayload.arguments,
      id: toolMessageId,
      parentId: assistantId,
      plugin: toolPayload,
      role: 'tool',
      tool_call_id: toolPayload.id,
    } as UIChatMessage;
    const invokeTool = vi.fn().mockResolvedValue({
      data: '{"ok":true}',
      outcome: 'completed',
      shouldContinue: true,
    });
    const reportToolBatch = vi
      .spyOn(toolTelemetryService, 'reportToolBatch')
      .mockResolvedValue({ reported: true });
    const reportToolCompletion = vi
      .spyOn(toolTelemetryService, 'reportToolCompletion')
      .mockResolvedValue({ reported: true });
    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (messageId) => () =>
        messageId === assistantId
          ? assistantMessage
          : messageId === toolMessageId
            ? toolMessage
            : undefined,
    );
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );
    const triggerAIMessage = vi.fn();

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: invokeTool,
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage, toolMessage],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(invokeTool).toHaveBeenCalledWith(toolMessageId, toolPayload, undefined, undefined);
    expect(reportToolBatch).not.toHaveBeenCalled();
    expect(reportToolCompletion).not.toHaveBeenCalled();
    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: toolMessageId,
        traceId: 'trace-id',
      }),
    );
  });

  it('preserves cache continuation metadata without lifecycle telemetry', async () => {
    const assistantId = 'assistant-cache-only-diagnostics';
    const toolMessageId = 'tool-message-cache-only-diagnostics';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"test"}',
      id: 'tool-cache-only-diagnostics',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const toolMessage = {
      content: toolPayload.arguments,
      id: toolMessageId,
      parentId: assistantId,
      plugin: toolPayload,
      role: 'tool',
      tool_call_id: toolPayload.id,
    } as UIChatMessage;
    const invokeTool = vi.fn().mockResolvedValue({
      data: '{"ok":true}',
      outcome: 'completed',
      shouldContinue: true,
    });
    const reportToolBatch = vi
      .spyOn(toolTelemetryService, 'reportToolBatch')
      .mockResolvedValue({ reported: true });
    const reportToolCompletion = vi
      .spyOn(toolTelemetryService, 'reportToolCompletion')
      .mockResolvedValue({ reported: true });
    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (messageId) => () =>
        messageId === assistantId
          ? assistantMessage
          : messageId === toolMessageId
            ? toolMessage
            : undefined,
    );
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );
    const triggerAIMessage = vi.fn();

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: invokeTool,
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage, toolMessage],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(invokeTool).toHaveBeenCalledWith(
      toolMessageId,
      toolPayload,
      expect.objectContaining({
        batchId: expect.stringMatching(/^tb_[\w-]{20}$/),
        continuationId: expect.stringMatching(/^tc_[\w-]{20}$/),
        toolCallCount: 1,
      }),
      undefined,
    );
    expect(reportToolBatch).not.toHaveBeenCalled();
    expect(reportToolCompletion).not.toHaveBeenCalled();
    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: toolMessageId,
        toolCacheDebug: expect.objectContaining({
          batchId: expect.stringMatching(/^tb_[\w-]{20}$/),
          continuationId: expect.stringMatching(/^tc_[\w-]{20}$/),
          failureCount: 0,
          resultCount: 1,
          toolCallCount: 1,
          toolResults: [expect.any(Object)],
        }),
        traceId: 'trace-id',
      }),
    );
  });

  it('reports a persisted built-in search error instead of its boolean control result', async () => {
    const assistantId = 'assistant-search';
    const toolMessageId = 'tool-message-search';
    const toolPayload = {
      apiName: 'search',
      arguments: '{"query":"private query"}',
      id: 'search-call',
      identifier: 'web-browsing',
      type: 'builtin',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const pluginError = {
      message: 'private search failure',
      type: 'PluginServerError',
    };
    const failedToolMessage = {
      content: '<search>private result content</search>',
      id: toolMessageId,
      parentId: assistantId,
      plugin: toolPayload,
      pluginError,
      role: 'tool',
      tool_call_id: toolPayload.id,
    } as UIChatMessage;
    const reportToolBatch = vi
      .spyOn(toolTelemetryService, 'reportToolBatch')
      .mockResolvedValue({ reported: true });
    const reportToolCompletion = vi
      .spyOn(toolTelemetryService, 'reportToolCompletion')
      .mockResolvedValue({ reported: true });
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (messageId) => () =>
        messageId === assistantId
          ? assistantMessage
          : messageId === toolMessageId
            ? failedToolMessage
            : undefined,
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      invokeBuiltinTool: vi.fn().mockResolvedValue(true),
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage, failedToolMessage],
      },
      triggerAIMessage: vi.fn(),
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    const callIdHash = createToolResultDebugSummary(toolPayload.id).valueHash;
    const expectedResult = createToolResultDebugSummary({
      callIdHash,
      data: pluginError,
    });
    const booleanResult = createToolResultDebugSummary({
      callIdHash,
      data: true,
    });

    expect(reportToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        result: expectedResult,
        runtimeType: 'builtin',
      }),
    );
    expect(expectedResult.valueHash).not.toBe(booleanResult.valueHash);
    expect(reportToolBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCount: 1, resultCount: 0 }),
      'settled',
    );
    expect(JSON.stringify(reportToolCompletion.mock.calls)).not.toContain('private search failure');
    expect(JSON.stringify(reportToolCompletion.mock.calls)).not.toContain('private result content');
  });

  it('reports a Python failure and does not resume the model', async () => {
    const assistantId = 'assistant-builtin-failure';
    const toolMessageId = 'tool-message-builtin-failure';
    const pythonError = new Error('private Python execution failure');
    const toolPayload = {
      apiName: 'python',
      arguments: '{"code":"raise RuntimeError()"}',
      id: 'python-call',
      identifier: 'code-interpreter',
      type: 'builtin',
    } as const;
    const assistantMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      tools: [toolPayload],
    } as UIChatMessage;
    const toolMessage = {
      content: toolPayload.arguments,
      id: toolMessageId,
      parentId: assistantId,
      plugin: toolPayload,
      role: 'tool',
      tool_call_id: toolPayload.id,
    } as UIChatMessage;
    const triggerAIMessage = vi.fn();
    vi.spyOn(toolTelemetryService, 'reportToolBatch').mockResolvedValue({ reported: true });
    const reportToolCompletion = vi
      .spyOn(toolTelemetryService, 'reportToolCompletion')
      .mockResolvedValue({ reported: true });
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (messageId) => () =>
        messageId === assistantId
          ? assistantMessage
          : messageId === toolMessageId
            ? toolMessage
            : undefined,
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      invokeBuiltinTool: vi.fn().mockResolvedValue({
        data: pythonError,
        outcome: 'failed',
        shouldContinue: false,
      }),
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage, toolMessage],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(triggerAIMessage).not.toHaveBeenCalled();
    expect(reportToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        result: createToolResultDebugSummary({
          callIdHash: createToolResultDebugSummary(toolPayload.id).valueHash,
          data: pythonError,
        }),
        runtimeType: 'builtin',
      }),
    );
    expect(JSON.stringify(reportToolCompletion.mock.calls)).not.toContain(
      'private Python execution failure',
    );
  });

  it('continues the model after MCP tools finish on a deferred browser lane after session switch', async () => {
    const assistantId = 'assistant-deferred-session-switch';
    const toolMessageId = 'tool-message-deferred-session-switch';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"azure regions"}',
      id: 'tool-deferred-session-switch',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: 'searching',
      id: assistantId,
      role: 'assistant',
      sessionId: 'session-id',
      tools: [toolPayload],
      topicId: 'topic-id',
    } as UIChatMessage;
    const triggerAIMessage = vi.fn();
    const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
    const logSpy = vi
      .spyOn(generationDebugClient, 'logDeferredGenerationLane')
      .mockResolvedValue();

    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );

    useChatStore.setState({
      // Viewing a different session while the deferred lane is still the producer.
      activeId: 'other-session',
      activeTopicId: 'other-topic',
      deferredBrowserGenerationLanes: {
        [conversationKey]: {
          assistantMessageId: assistantId,
          reason: 'unsupported_tool',
          toolName: 'kagi',
        },
      },
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
        data: '{"ok":true}',
        outcome: 'completed',
      }),
      internal_toggleMessageInToolsCalling: vi.fn().mockResolvedValue(undefined),
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage],
        [messageMapKey('other-session', 'other-topic')]: [],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: toolMessageId,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'tool_loop_continue',
      expect.objectContaining({
        completedCount: 1,
        hasDeferredLane: true,
        sameSession: false,
        visible: false,
      }),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      'tool_loop_continue_skipped',
      expect.objectContaining({ reason: 'session_changed' }),
    );
  });

  it('continues the model after MCP tools finish on a deferred browser lane in the same session', async () => {
    const assistantId = 'assistant-deferred-mcp';
    const toolMessageId = 'tool-message-deferred-mcp';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"azure regions"}',
      id: 'tool-deferred-mcp',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: 'searching',
      id: assistantId,
      role: 'assistant',
      sessionId: 'session-id',
      tools: [toolPayload],
      topicId: 'topic-id',
    } as UIChatMessage;
    const triggerAIMessage = vi.fn();
    const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
    const logSpy = vi
      .spyOn(generationDebugClient, 'logDeferredGenerationLane')
      .mockResolvedValue();

    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'other-topic',
      deferredBrowserGenerationLanes: {
        [conversationKey]: {
          assistantMessageId: assistantId,
          reason: 'unsupported_tool',
          toolName: 'lobe-image-designer',
        },
      },
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
        data: '{"ok":true}',
        outcome: 'completed',
      }),
      internal_toggleMessageInToolsCalling: vi.fn().mockResolvedValue(undefined),
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage],
        [messageMapKey('session-id', 'other-topic')]: [],
      },
      triggerAIMessage,
    });

    await useChatStore.getState().triggerToolCalls(assistantId);

    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: toolMessageId,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'tool_loop_continue',
      expect.objectContaining({
        completedCount: 1,
        hasDeferredLane: true,
        visible: false,
      }),
    );
  });

  it('keeps a persisted MCP result when the user leaves after the RPC returns', async () => {
    const abortController = new AbortController();
    const toolResult = '{"ok":true}';
    const dispatchMessage = vi.fn();
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockImplementation(async () => {
      abortController.abort();
      useChatStore.setState({ activeTopicId: 'other-topic' });
      return { content: toolResult, persistence: 'persisted' };
    });

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      conversationClearGeneration: 0,
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_dispatchMessage: dispatchMessage,
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(abortController),
    });

    await expect(
      useChatStore.getState().invokeMCPTypePlugin('message-id', payload),
    ).resolves.toEqual({ data: toolResult });

    expect(dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'message-id',
        type: 'updateMessage',
        value: { content: toolResult },
      },
      expect.objectContaining({
        sessionId: 'session-id',
        topicId: 'topic-id',
      }),
    );
  });

  it('continues the model when the user leaves the topic while MCP is in flight', async () => {
    const assistantId = 'assistant-leave-during-mcp';
    const toolMessageId = 'tool-message-leave-during-mcp';
    const toolPayload = {
      apiName: 'tavily_search',
      arguments: '{"query":"azure regions"}',
      id: 'tool-leave-during-mcp',
      identifier: 'tavily',
      type: 'mcp',
    } as const;
    const assistantMessage = {
      content: 'searching',
      id: assistantId,
      role: 'assistant',
      sessionId: 'session-id',
      tools: [toolPayload],
      topicId: 'topic-id',
    } as UIChatMessage;
    const triggerAIMessage = vi.fn();
    const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
    const deferredInvocation = createDeferred<{
      data: string;
      outcome: 'completed';
    }>();

    vi.mocked(toolTelemetryService.getCapabilities).mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(
      vi.fn().mockReturnValue('trace-id'),
    );

    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      conversationClearGeneration: 0,
      deferredBrowserGenerationLanes: {
        [conversationKey]: {
          assistantMessageId: assistantId,
          reason: 'unsupported_tool',
          toolName: 'lobe-image-designer',
        },
      },
      internal_createMessage: vi.fn().mockResolvedValue(toolMessageId),
      internal_invokeDifferentTypePlugin: vi.fn().mockReturnValue(deferredInvocation.promise),
      internal_toggleMessageInToolsCalling: vi.fn().mockResolvedValue(undefined),
      messagesMap: {
        [messageMapKey('session-id', 'topic-id')]: [assistantMessage],
        [messageMapKey('session-id', 'other-topic')]: [],
      },
      triggerAIMessage,
    });

    const toolBatchPromise = useChatStore.getState().triggerToolCalls(assistantId);
    await vi.waitFor(() => {
      expect(useChatStore.getState().internal_invokeDifferentTypePlugin).toHaveBeenCalledOnce();
    });

    useChatStore.setState((state) => ({
      activeTopicId: 'other-topic',
      conversationNavigationGeneration: state.conversationNavigationGeneration + 1,
    }));
    deferredInvocation.resolve({
      data: '{"ok":true}',
      outcome: 'completed',
    });

    await toolBatchPromise;

    expect(triggerAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
        parentId: toolMessageId,
      }),
    );
  });
});
