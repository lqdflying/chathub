import { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { mcpService } from '@/services/mcp';
import { chatSelectors } from '@/store/chat/selectors';
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

  it('retries a classified persistence failure and returns the valid tool result', async () => {
    const toolResult = '{"results":[{"title":"ok"}]}';
    const updateMessageContent = vi
      .fn()
      .mockRejectedValueOnce(createHTMLRPCError())
      .mockResolvedValueOnce(undefined);
    const togglePluginCalling = vi.fn().mockReturnValue(new AbortController());
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue(toolResult);
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
    vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue(toolResult);
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
    });
  });
});
