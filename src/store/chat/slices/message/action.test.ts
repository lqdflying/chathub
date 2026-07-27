import { TraceEventType, UIChatMessage } from '@lobechat/types';
import * as lobeUIModules from '@lobehub/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useChatStore } from '../../store';

const { reportClientRPCFailure } = vi.hoisted(() => ({
  reportClientRPCFailure: vi.fn(),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response('mock'))),
);

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
// Mock service
vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: vi.fn(() => Promise.resolve('new-message-id')),
    getMessages: vi.fn(),
    removeAllTopicsHistory: vi.fn(() => Promise.resolve()),
    removeMessage: vi.fn(),
    removeMessages: vi.fn(() => Promise.resolve()),
    removeMessagesByAssistant: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    createTopic: vi.fn(() => Promise.resolve()),
    removeTopic: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/services/rpcDiagnostics', () => ({
  rpcDiagnosticsService: { reportClientRPCFailure },
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const realRefreshMessages = useChatStore.getState().refreshMessages;
// Mock state
const mockState = {
  activeId: 'session-id',
  activeThreadId: undefined,
  activeTopicId: 'topic-id',
  internal_coreProcessMessage: vi.fn(),
  messages: [],
  refreshMessages: vi.fn(() => Promise.resolve()),
  refreshTopic: vi.fn(() => Promise.resolve()),
  saveToTopic: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({ ownershipInvalidationGeneration: 0 });
  useChatStore.setState(mockState, false);
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = undefined;

  vi.restoreAllMocks();
});

describe('chatMessage actions', () => {
  describe('internal_invalidateConversation', () => {
    it('clears every invalidated conversation operation and preserves other conversations', () => {
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        serverGenerationOperations: {
          'other-session_other-topic': {
            'other-operation': {
              generation: 1,
              operationId: 'other-operation',
              sessionId: 'other-session',
              topicId: 'other-topic',
              userScope: 'user:account-a',
            },
          },
          'session-id_topic-id': {
            'current-operation-one': {
              generation: 1,
              operationId: 'current-operation-one',
              sessionId: 'session-id',
              topicId: 'topic-id',
              userScope: 'user:account-a',
            },
            'current-operation-two': {
              generation: 1,
              operationId: 'current-operation-two',
              sessionId: 'session-id',
              topicId: 'topic-id',
              userScope: 'user:account-a',
            },
          },
        },
      });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(useChatStore.getState().serverGenerationOperations).toEqual({
        'other-session_other-topic': {
          'other-operation': {
            generation: 1,
            operationId: 'other-operation',
            sessionId: 'other-session',
            topicId: 'other-topic',
            userScope: 'user:account-a',
          },
        },
      });
    });
  });

  describe('addAIMessage', () => {
    it('should return early if activeId is undefined', async () => {
      useChatStore.setState({ activeId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateInputMessageSpy).not.toHaveBeenCalled();
    });

    it('should call internal_createMessage with correct parameters', async () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: inputMessage,
        role: 'assistant',
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
      });
    });

    it('should call updateInputMessage with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');
      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(updateInputMessageSpy).toHaveBeenCalledWith('');
    });

    it('should not clear a newer draft after stale assistant message creation', async () => {
      const createdMessage = createDeferred<string | undefined>();
      vi.mocked(messageService.createMessage).mockReturnValue(createdMessage.promise);
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeId: 'account-a-session',
          activeTopicId: 'account-a-topic',
          conversationClearGeneration: 0,
          inputMessage: 'account A draft',
        });
      });

      let addMessagePromise!: ReturnType<typeof result.current.addAIMessage>;
      act(() => {
        addMessagePromise = result.current.addAIMessage();
      });

      await waitFor(() => {
        expect(messageService.createMessage).toHaveBeenCalled();
      });

      act(() => {
        useChatStore.setState({
          activeId: 'account-b-session',
          activeTopicId: 'account-b-topic',
          conversationClearGeneration: 1,
          inputMessage: 'account B draft',
        });
      });
      createdMessage.resolve(undefined);

      await act(async () => {
        await addMessagePromise;
      });

      expect(useChatStore.getState().inputMessage).toBe('account B draft');
    });
  });

  describe('addUserMessage', () => {
    it('should return early if activeId is undefined', async () => {
      useChatStore.setState({ activeId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test message' });
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateInputMessageSpy).not.toHaveBeenCalled();
    });

    it('should call internal_createMessage with correct parameters', async () => {
      const message = 'Test user message';
      const fileList = ['file-id-1', 'file-id-2'];
      useChatStore.setState({
        activeId: mockState.activeId,
        activeTopicId: mockState.activeTopicId,
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ fileList, message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: fileList,
        role: 'user',
        sessionId: mockState.activeId,
        threadId: undefined,
        topicId: mockState.activeTopicId,
      });
    });

    it('should call internal_createMessage with threadId when activeThreadId is set', async () => {
      const message = 'Test user message';
      const activeThreadId = 'thread-123';
      useChatStore.setState({
        activeId: mockState.activeId,
        activeThreadId,
        activeTopicId: mockState.activeTopicId,
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        sessionId: mockState.activeId,
        threadId: activeThreadId,
        topicId: mockState.activeTopicId,
      });
    });

    it('should call updateInputMessage with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test' });
      });

      expect(updateInputMessageSpy).toHaveBeenCalledWith('');
    });

    it('should not clear a newer draft after stale user message creation', async () => {
      const createdMessage = createDeferred<string | undefined>();
      vi.mocked(messageService.createMessage).mockReturnValue(createdMessage.promise);
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeId: 'account-a-session',
          activeThreadId: undefined,
          activeTopicId: 'account-a-topic',
          conversationClearGeneration: 0,
          inputMessage: 'account A draft',
        });
      });

      let addMessagePromise!: ReturnType<typeof result.current.addUserMessage>;
      act(() => {
        addMessagePromise = result.current.addUserMessage({ message: 'account A message' });
      });

      await waitFor(() => {
        expect(messageService.createMessage).toHaveBeenCalled();
      });

      act(() => {
        useChatStore.setState({
          activeId: 'account-b-session',
          activeTopicId: 'account-b-topic',
          conversationClearGeneration: 1,
          inputMessage: 'account B draft',
        });
      });
      createdMessage.resolve(undefined);

      await act(async () => {
        await addMessagePromise;
      });

      expect(useChatStore.getState().inputMessage).toBe('account B draft');
    });

    it('should handle message without fileList', async () => {
      const message = 'Test user message without files';
      useChatStore.setState({ activeId: mockState.activeId });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        sessionId: mockState.activeId,
        threadId: undefined,
        topicId: mockState.activeTopicId,
      });
    });
  });

  describe('deleteMessage', () => {
    it('does not delete or change local messages during an active owner mismatch', async () => {
      vi.spyOn(authSelectors, 'hasActiveUserStateOwnerMismatch').mockReturnValue(true);
      const messageId = 'message-id';
      const messages = [{ id: messageId } as UIChatMessage];
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: undefined,
        messagesMap: { [messageMapKey('session-id')]: messages },
      });

      await useChatStore.getState().deleteMessage(messageId);

      expect(messageService.removeMessages).not.toHaveBeenCalled();
      expect(useChatStore.getState().messagesMap[messageMapKey('session-id')]).toEqual(messages);
    });

    it('deleteMessage should remove a message by id', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const deleteSpy = vi.spyOn(result.current, 'deleteMessage');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [{ id: messageId } as UIChatMessage],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      expect(deleteSpy).toHaveBeenCalledWith(messageId);
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('does not refresh messages after ownership invalidates during deletion', async () => {
      const removedMessages = createDeferred<void>();
      vi.mocked(messageService.removeMessages).mockReturnValue(removedMessages.promise);
      const refreshMessages = vi.fn();
      const messageId = 'message-id';
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: undefined,
        messagesMap: {
          [messageMapKey('session-id')]: [{ id: messageId } as UIChatMessage],
        },
        refreshMessages,
      });

      const deletePromise = useChatStore.getState().deleteMessage(messageId);
      await waitFor(() => {
        expect(messageService.removeMessages).toHaveBeenCalledWith([messageId]);
      });

      act(() => {
        useUserStore.setState({
          ownershipInvalidationGeneration:
            useUserStore.getState().ownershipInvalidationGeneration + 1,
        });
      });
      removedMessages.resolve(undefined);
      await deletePromise;

      expect(refreshMessages).not.toHaveBeenCalled();
    });

    it('deleteMessage should remove messages with tools', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [
              { id: messageId, tools: [{ id: 'tool1' }, { id: 'tool2' }] } as UIChatMessage,
              { id: '2', role: 'tool', tool_call_id: 'tool1' } as UIChatMessage,
              { id: '3', role: 'tool', tool_call_id: 'tool2' } as UIChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith([messageId, '2', '3']);
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('copyMessage', () => {
    it('should call copyToClipboard with correct content', async () => {
      const messageId = 'message-id';
      const content = 'Test content';
      const { result } = renderHook(() => useChatStore());
      const copyToClipboardSpy = vi.spyOn(lobeUIModules, 'copyToClipboard');

      await act(async () => {
        await result.current.copyMessage(messageId, content);
      });

      expect(copyToClipboardSpy).toHaveBeenCalledWith(content);
    });

    it('should call internal_traceMessage with correct parameters', async () => {
      const messageId = 'message-id';
      const content = 'Test content';
      const { result } = renderHook(() => useChatStore());
      const internal_traceMessageSpy = vi.spyOn(result.current, 'internal_traceMessage');

      await act(async () => {
        await result.current.copyMessage(messageId, content);
      });

      expect(internal_traceMessageSpy).toHaveBeenCalledWith(messageId, {
        eventType: TraceEventType.CopyMessage,
      });
    });
  });

  describe('deleteToolMessage', () => {
    it('deleteMessage should remove a message by id', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');
      const removeMessageSpy = vi.spyOn(messageService, 'removeMessage');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [
              {
                id: messageId,
                role: 'assistant',
                tools: [{ id: 'tool1' }, { id: 'tool2' }],
              } as UIChatMessage,
              {
                id: '2',
                parentId: messageId,
                role: 'tool',
                tool_call_id: 'tool1',
              } as UIChatMessage,
              { id: '3', role: 'tool', tool_call_id: 'tool2' } as UIChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteToolMessage('2');
      });

      expect(removeMessageSpy).toHaveBeenCalled();
      expect(updateMessageSpy).toHaveBeenCalledWith('message-id', {
        tools: [{ id: 'tool2' }],
      });
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('clearAllTopicsHistory', () => {
    it('clears history state and returns to the default topic', async () => {
      useToolStore.setState({ builtinToolLoading: { python: true } });
      useChatStore.setState({
        activePageContentUrl: 'https://example.com',
        activeThreadId: 'thread-id',
        activeTopicId: 'topic-id',
        codeInterpreterExecuting: { 'tool-message': true },
        codeInterpreterImageMap: {
          'image-id': { id: 'image-id' } as any,
        },
        creatingThreadId: 'thread-create-operation',
        creatingTopic: true,
        dalleImageLoading: { 'tool-message-prompt': true },
        dalleImageMap: {
          'dalle-image-id': { id: 'dalle-image-id' } as any,
        },
        inSearchingMode: true,
        isCreatingThread: true,
        isCreatingThreadMessage: true,
        isSearchingTopic: true,
        localFileLoading: { 'tool-message': true },
        messagesInit: true,
        messagesMap: { cached: [{ id: 'message-id' } as UIChatMessage] },
        portalMessageDetail: 'message-id',
        portalThreadId: 'thread-id',
        portalToolMessage: { id: 'tool-message', identifier: 'tool' },
        searchLoading: { 'tool-message': true },
        searchTopics: [{ id: 'search-topic', title: 'Search result' }],
        serverGenerationOperations: {
          'session-id_topic-id': {
            'generation-operation': {
              generation: 1,
              operationId: 'generation-operation',
              sessionId: 'session-id',
              topicId: 'topic-id',
              userScope: 'user:account-a',
            },
          },
        },
        showPortal: true,
        startToForkThread: true,
        supervisorTodos: { cached: [] },
        threadInputMessage: 'thread draft',
        threadMaps: { 'topic-id': [] },
        threadStartMessageId: 'message-id',
        threadsInit: true,
        topicMaps: { 'session-id': [{ id: 'topic-id', title: 'Topic' }] },
        topicSearchKeywords: 'search',
        topicsInit: true,
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.clearAllTopicsHistory();
      });

      expect(messageService.removeAllTopicsHistory).toHaveBeenCalledOnce();
      expect(useChatStore.getState()).toMatchObject({
        activePageContentUrl: undefined,
        activeThreadId: undefined,
        activeTopicId: null,
        codeInterpreterExecuting: {},
        codeInterpreterImageMap: {},
        creatingThreadId: undefined,
        creatingTopic: false,
        dalleImageLoading: {},
        dalleImageMap: {},
        inSearchingMode: false,
        isCreatingThread: false,
        isCreatingThreadMessage: false,
        isSearchingTopic: false,
        localFileLoading: {},
        messagesInit: false,
        messagesMap: {},
        portalMessageDetail: undefined,
        portalThreadId: undefined,
        portalToolMessage: undefined,
        searchLoading: {},
        searchTopics: [],
        serverGenerationOperations: {},
        showPortal: false,
        startToForkThread: undefined,
        supervisorTodos: {},
        threadInputMessage: '',
        threadMaps: {},
        threadStartMessageId: undefined,
        threadsInit: false,
        topicMaps: {},
        topicSearchKeywords: '',
        topicsInit: false,
      });
      expect(useToolStore.getState().builtinToolLoading).toEqual({});
      expect(mockState.refreshMessages).toHaveBeenCalledOnce();
      expect(mockState.refreshTopic).toHaveBeenCalledOnce();
    });
  });

  describe('updateInputMessage', () => {
    it('updateInputMessage should update the input message state', () => {
      const { result } = renderHook(() => useChatStore());
      const newInputMessage = 'Updated message';
      act(() => {
        result.current.updateInputMessage(newInputMessage);
      });

      expect(result.current.inputMessage).toEqual(newInputMessage);
    });

    it('should not update state if message is the same as current inputMessage', () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.updateInputMessage(inputMessage);
      });

      expect(result.current.inputMessage).toBe(inputMessage);
    });
  });

  describe('clearMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks(); // 清除 mocks
      useChatStore.setState(mockState, false); // 重置 state
    });

    afterEach(() => {
      vi.restoreAllMocks(); // 恢复所有模拟
    });
    it('clearMessage should remove messages from the active session and topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const clearSpy = vi.spyOn(result.current, 'clearMessage');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(clearSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
      expect(result.current.refreshTopic).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should remove messages from the active session and topic, then refresh topics and messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();

      // 检查 activeTopicId 是否被清除，需要在状态更新后进行检查
      expect(useChatStore.getState().activeTopicId).toBeNull();
    });

    it('should call removeTopic if there is an activeTopicId', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.activeTopicId).not.toBeUndefined(); // 确保在测试前 activeTopicId 存在
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(topicService.removeTopic).toHaveBeenCalledWith(mockState.activeTopicId);
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });

  describe('toggleMessageEditing ', () => {
    it('should add message id to messageEditingIds when editing is true', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
      });

      expect(result.current.messageEditingIds).toContain(messageId);
    });

    it('should remove message id from messageEditingIds when editing is false', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'abc';

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
        result.current.toggleMessageEditing(messageId, false);
      });

      expect(result.current.messageEditingIds).not.toContain(messageId);
    });

    it('should update messageEditingIds correctly when enabling editing', () => {
      const messageId = 'message-id';
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
      });

      expect(result.current.messageEditingIds).toContain(messageId);
    });

    it('should update messageEditingIds correctly when disabling editing', () => {
      const messageId = 'message-id';
      useChatStore.setState({ messageEditingIds: [messageId] });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.toggleMessageEditing(messageId, false);
      });

      expect(result.current.messageEditingIds).not.toContain(messageId);
    });
  });

  describe('internal_createMessage', () => {
    it('preserves a confirmed create when message revalidation fails', async () => {
      const chatKey = messageMapKey(mockState.activeId, mockState.activeTopicId);
      const refreshMessages = vi.fn().mockRejectedValue(new Error('revalidation failed'));
      useChatStore.setState({
        messageLoadingIds: [],
        messagesMap: { [chatKey]: [] },
        refreshMessages,
      });
      const { result } = renderHook(() => useChatStore());

      const messageId = await act(async () =>
        result.current.internal_createMessage({
          content: 'assistant placeholder',
          role: 'assistant',
          sessionId: mockState.activeId,
          topicId: mockState.activeTopicId,
        }),
      );

      expect(messageId).toBe('new-message-id');
      expect(refreshMessages).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().messagesMap[chatKey]).toEqual([
        expect.objectContaining({
          content: 'assistant placeholder',
          id: 'new-message-id',
          role: 'assistant',
        }),
      ]);
      expect(useChatStore.getState().messagesMap[chatKey][0].error).toBeUndefined();
      expect(useChatStore.getState().messageLoadingIds).toEqual([]);
    });
  });

  describe('internal_updateMessageContent', () => {
    it('should call messageService.internal_updateMessageContent with correct parameters', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      const spy = vi.spyOn(messageService, 'updateMessage');
      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(spy).toHaveBeenCalledWith(messageId, { content: newContent });
    });

    it('should dispatch message update action', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';
      const internal_dispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(internal_dispatchMessageSpy).toHaveBeenCalledWith(
        {
          id: messageId,
          type: 'updateMessage',
          value: { content: newContent },
        },
        undefined,
      );
    });

    it('should refresh messages after updating content', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('retries a classified assistant finalization with the same payload and diagnostic ID', async () => {
      const gatewayError = new ToolsRPCResponseError({
        bodyKind: 'html',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 123,
        failurePhase: 'response_parse',
        httpStatus: 502,
        mediaType: 'text/html',
        operation: 'finalize_assistant_message',
        reason: 'response_parse_failed',
      });
      const updateMessage = vi
        .spyOn(messageService, 'updateMessage')
        .mockRejectedValueOnce(gatewayError)
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
        }),
      );

      expect(response).toEqual({ persistenceAmbiguous: false });
      expect(updateMessage).toHaveBeenCalledTimes(2);
      expect(updateMessage.mock.calls[0]).toEqual(updateMessage.mock.calls[1]);
      expect(updateMessage).toHaveBeenCalledWith(
        'message-id',
        { content: 'final content' },
        {
          diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
          diagnosticOperation: 'finalize_assistant_message',
          showNotification: false,
        },
      );
      expect(reportClientRPCFailure).toHaveBeenCalledWith(
        expect.objectContaining({ bodyKind: 'html', httpStatus: 502 }),
        expect.objectContaining({
          attempt: 1,
          operation: 'finalize_assistant_message',
          procedure: 'message.update',
          rpcEndpoint: 'lambda',
        }),
      );
    });

    it('keeps a confirmed assistant finalization when revalidation fails', async () => {
      const refreshMessages = vi.fn().mockRejectedValue(new Error('revalidation failed'));
      useChatStore.setState({ refreshMessages });
      const updateMessage = vi.spyOn(messageService, 'updateMessage').mockResolvedValue(undefined);
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
        }),
      );

      expect(response).toEqual({ persistenceAmbiguous: false });
      expect(updateMessage).toHaveBeenCalledTimes(1);
      expect(refreshMessages).toHaveBeenCalledTimes(1);
    });

    it('reconciles double ambiguity and restores the streamed final payload', async () => {
      const gatewayError = new ToolsRPCResponseError({
        bodyKind: 'html',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 123,
        failurePhase: 'response_parse',
        httpStatus: 502,
        mediaType: 'text/html',
        operation: 'finalize_assistant_message',
        reason: 'response_parse_failed',
      });
      const updateMessage = vi
        .spyOn(messageService, 'updateMessage')
        .mockRejectedValue(gatewayError);
      const dispatchMessage = vi.fn();
      const refreshMessages = vi.fn();
      useChatStore.setState({ internal_dispatchMessage: dispatchMessage, refreshMessages });
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
        }),
      );

      expect(response).toEqual({ persistenceAmbiguous: true });
      expect(updateMessage).toHaveBeenCalledTimes(2);
      expect(reportClientRPCFailure).toHaveBeenCalledTimes(2);
      expect(refreshMessages).toHaveBeenCalledTimes(1);
      expect(dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'message-id',
          type: 'updateMessage',
          value: { content: 'final content' },
        },
        undefined,
      );
    });

    it('does not absorb non-gateway assistant finalization failures', async () => {
      vi.spyOn(messageService, 'updateMessage').mockRejectedValue(new Error('database rejected'));
      const { result } = renderHook(() => useChatStore());

      await expect(
        act(async () =>
          result.current.internal_updateMessageContent('message-id', 'final content', {
            persistenceRecovery: 'assistant_finalization',
          }),
        ),
      ).rejects.toThrow('database rejected');
    });
  });

  describe('refreshMessages action', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });
    afterEach(() => {
      // 在每个测试用例开始前恢复到实际的 SWR 实现
      vi.resetAllMocks();
    });
    it('should refresh messages by calling mutate for both session and group types', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });

      const { result } = renderHook(() => useChatStore());
      const activeId = useChatStore.getState().activeId;
      const activeTopicId = useChatStore.getState().activeTopicId;

      // 在这里，我们不需要再次模拟 mutate，因为它已经在顶部被模拟了
      await act(async () => {
        await result.current.refreshMessages();
      });

      // 确保 mutate 调用了正确的参数（session 和 group 两次）
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        'local',
        activeId,
        activeTopicId,
        'session',
        ['account-cache-epoch', 0],
      ]);
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        'local',
        activeId,
        activeTopicId,
        'group',
        ['account-cache-epoch', 0],
      ]);
      expect(mutate).toHaveBeenCalledTimes(2);
    });

    it('does not start the group refresh after ownership invalidates', async () => {
      const firstMutation = createDeferred<void>();
      vi.mocked(mutate).mockReturnValueOnce(firstMutation.promise);
      useChatStore.setState({ refreshMessages: realRefreshMessages });

      const refreshPromise = useChatStore.getState().refreshMessages();
      await waitFor(() => {
        expect(mutate).toHaveBeenCalledTimes(1);
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      });
      firstMutation.resolve(undefined);
      await refreshPromise;

      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during refreshing messages', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });
      const { result } = renderHook(() => useChatStore());

      // 设置模拟错误
      (mutate as Mock).mockImplementation(() => {
        throw new Error('Mutate error');
      });

      await act(async () => {
        await expect(result.current.refreshMessages()).rejects.toThrow('Mutate error');
      });

      // 确保恢复 mutate 的模拟，以免影响其他测试
      (mutate as Mock).mockReset();
    });
  });

  describe('useFetchMessages hook', () => {
    // beforeEach(() => {
    //   vi.mocked(useSWR).mockRestore();
    // });

    it('should fetch messages for given session and topic ids', async () => {
      const sessionId = 'session-id';
      const topicId = 'topic-id';
      const messages = [{ content: 'Hello', id: 'message-id' }];

      // 设置模拟返回值
      (messageService.getMessages as Mock).mockResolvedValue(messages);

      const { result } = renderHook(() =>
        useChatStore().useFetchMessages(true, sessionId, topicId),
      );

      // 等待异步操作完成
      await waitFor(() => {
        expect(result.current.data).toEqual(messages);
      });
    });
  });

  describe('internal_toggleMessageLoading', () => {
    it('should add message id to messageLoadingIds when loading is true', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        result.current.internal_toggleMessageLoading(true, messageId);
      });

      expect(result.current.messageLoadingIds).toContain(messageId);
    });

    it('should remove message id from messageLoadingIds when loading is false', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'ddd-id';

      act(() => {
        result.current.internal_toggleMessageLoading(true, messageId);
        result.current.internal_toggleMessageLoading(false, messageId);
      });

      expect(result.current.messageLoadingIds).not.toContain(messageId);
    });
  });

  describe('modifyMessageContent', () => {
    it('should call internal_traceMessage with correct parameters before updating', async () => {
      const messageId = 'message-id';
      const content = 'Updated content';
      const { result } = renderHook(() => useChatStore());

      const spy = vi.spyOn(result.current, 'internal_traceMessage');
      await act(async () => {
        await result.current.modifyMessageContent(messageId, content);
      });

      expect(spy).toHaveBeenCalledWith(messageId, {
        eventType: TraceEventType.ModifyMessage,
        nextContent: content,
      });
    });

    it('should call internal_updateMessageContent with correct parameters', async () => {
      const messageId = 'message-id';
      const content = 'Updated content';
      const { result } = renderHook(() => useChatStore());

      const spy = vi.spyOn(result.current, 'internal_traceMessage');

      await act(async () => {
        await result.current.modifyMessageContent(messageId, content);
      });

      expect(spy).toHaveBeenCalledWith(messageId, {
        eventType: 'Modify Message',
        nextContent: 'Updated content',
      });
    });
  });
});
