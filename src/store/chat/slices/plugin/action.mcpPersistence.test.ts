import { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { mcpService } from '@/services/mcp';
import { toolTelemetryService } from '@/services/toolTelemetry';
import { chatSelectors, threadSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('@/components/AntdStaticMethods', () => ({
  notification: { warning: vi.fn() },
}));

const initialState = useChatStore.getInitialState();

const createHTMLRPCError = () =>
  new ToolsRPCResponseError({
    bodyBytes: 615,
    bodyKind: 'html',
    diagnosticId: 'td_originaldiagnostic',
    durationMs: 123,
    failurePhase: 'response_parse',
    htmlMarker: 'doctype',
    httpStatus: 502,
    mediaType: 'text/html',
    reason: 'response_parse_failed',
    responseFingerprint: 'abcdef0123456789',
  });

describe('MCP tool-result persistence recovery', () => {
  const payload = {
    apiName: 'tavily_search',
    arguments: '{"query":"test"}',
    identifier: 'tavily',
    type: 'mcp',
  } as ChatToolPayload;

  beforeEach(() => {
    useChatStore.setState(initialState, true);
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

  it('retries a classified persistence failure and returns the valid tool result', async () => {
    const toolResult = '{"results":[{"title":"ok"}]}';
    const updateMessageContent = vi
      .fn()
      .mockRejectedValueOnce(createHTMLRPCError())
      .mockResolvedValueOnce(undefined);
    const togglePluginCalling = vi.fn().mockReturnValue(new AbortController());
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue({
      content: toolResult,
      persistence: 'client_required',
    });
    const reportFailure = vi
      .spyOn(mcpService, 'reportClientRPCFailure')
      .mockImplementation(() => undefined);

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_togglePluginApiCalling: togglePluginCalling,
      internal_updateMessageContent: updateMessageContent,
    });

    const response = await useChatStore.getState().invokeMCPTypePlugin('message-id', payload);

    expect(response).toBe(toolResult);
    expect(updateMessageContent).toHaveBeenCalledTimes(2);
    expect(updateMessageContent).toHaveBeenLastCalledWith(
      'message-id',
      toolResult,
      expect.objectContaining({
        diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
        showNotification: false,
        skipRefresh: true,
      }),
    );
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ bodyKind: 'html', responseFingerprint: 'abcdef0123456789' }),
      expect.objectContaining({
        attempt: 1,
        diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
        operation: 'persist_tool_result',
        procedure: 'message.update',
        rpcEndpoint: 'lambda',
      }),
    );
    const { notification } = await import('@/components/AntdStaticMethods');
    expect(notification.warning).not.toHaveBeenCalled();
    expect(togglePluginCalling).toHaveBeenLastCalledWith(false, 'message-id', expect.any(String));
  });

  it('continues in memory and warns once when both persistence attempts fail', async () => {
    const toolResult = '{"results":[{"title":"ok"}]}';
    const updateMessageContent = vi.fn().mockRejectedValue(createHTMLRPCError());
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue({
      content: toolResult,
      persistence: 'client_required',
    });
    const reportFailure = vi
      .spyOn(mcpService, 'reportClientRPCFailure')
      .mockImplementation(() => undefined);

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(new AbortController()),
      internal_updateMessageContent: updateMessageContent,
    });

    const response = await useChatStore.getState().invokeMCPTypePlugin('message-id', payload);

    expect(response).toBe(toolResult);
    expect(updateMessageContent).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ attempt: 2, operation: 'persist_tool_result' }),
    );
    const { notification } = await import('@/components/AntdStaticMethods');
    expect(notification.warning).toHaveBeenCalledTimes(1);
  });

  it('uses a server-persisted result without reposting it through the lambda route', async () => {
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

    const response = await useChatStore.getState().invokeMCPTypePlugin('message-id', payload);

    expect(response).toBe(toolResult);
    expect(invokeTool).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ messageId: 'message-id', topicId: 'topic-id' }),
    );
    expect(dispatchMessage).toHaveBeenCalledWith({
      id: 'message-id',
      type: 'updateMessage',
      value: { content: toolResult },
    });
    expect(updateMessageContent).not.toHaveBeenCalled();
  });

  it('preserves a requested diagnostic ID across MCP invocation and persistence', async () => {
    const requestedDiagnosticId = 'td_requesteddiagnostic';
    const toolResult = '{"results":[{"title":"correlated"}]}';
    const updateMessageContent = vi.fn().mockResolvedValue(undefined);
    const invokeTool = vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue({
      content: toolResult,
      persistence: 'client_required',
    });

    useChatStore.setState({
      internal_constructToolsCallingContext: vi.fn().mockReturnValue({ topicId: 'topic-id' }),
      internal_togglePluginApiCalling: vi.fn().mockReturnValue(new AbortController()),
      internal_updateMessageContent: updateMessageContent,
    });

    const response = await useChatStore
      .getState()
      .invokeMCPTypePlugin('message-id', payload, undefined, requestedDiagnosticId);

    expect(response).toBe(toolResult);
    expect(invokeTool).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        diagnosticId: requestedDiagnosticId,
        messageId: 'message-id',
        topicId: 'topic-id',
      }),
    );
    expect(updateMessageContent).toHaveBeenCalledWith(
      'message-id',
      toolResult,
      expect.objectContaining({ diagnosticId: requestedDiagnosticId }),
    );
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

    await expect(useChatStore.getState().invokeMCPTypePlugin('message-id', payload)).resolves.toBe(
      toolResult,
    );

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
      inPortalThread: undefined,
      inSearchWorkflow: undefined,
      isToolContinuation: true,
      threadId: undefined,
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
      inPortalThread: true,
      inSearchWorkflow: undefined,
      isToolContinuation: true,
      threadId: 'thread-id',
      traceId: 'trace-id',
    });
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
    expect(triggerAIMessage).toHaveBeenCalledWith({
      inPortalThread: undefined,
      inSearchWorkflow: undefined,
      threadId: undefined,
      traceId: 'trace-id',
      toolCacheDebug: {
        toolCallCount: 2,
        toolCallSetHash: expect.stringMatching(/^[\da-f]{16}$/),
        toolResults: [
          {
            serializedLength: 11,
            truncated: false,
            type: 'string',
            valueHash: expect.stringMatching(/^[\da-f]{16}$/),
          },
        ],
      },
    });
    expect(reportToolCompletion).toHaveBeenCalledTimes(1);
    expect(reportToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        correlation: {
          toolCallCount: 2,
          toolCallSetHash: expect.stringMatching(/^[\da-f]{16}$/),
        },
        diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
        runtimeType: 'mcp',
        toolNameHash: expect.stringMatching(/^[\da-f]{16}$/),
      }),
    );

    resolveTelemetry({ reported: true });
    await pendingTelemetry;
  });
});
