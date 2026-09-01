import { TraceEventType, UIChatMessage } from '@lobechat/types';
import * as lobeUIModules from '@lobehub/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as generationDebugClient from '@/libs/logger/generationDebugClient';
import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
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
    getMessageById: vi.fn(),
    getMessages: vi.fn(),
    removeAllTopicsHistory: vi.fn(() => Promise.resolve()),
    removeMessage: vi.fn(),
    removeMessages: vi.fn(() => Promise.resolve()),
    removeMessagesByAssistant: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
    updateMessageRAG: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    createTopic: vi.fn(() => Promise.resolve()),
    updateTopic: vi.fn(() => Promise.resolve()),
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
  vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
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
      const cancel = vi.spyOn(conversationGenerationService, 'cancel');
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        serverGenerationOperations: {
          [messageMapKey('other-session', 'other-topic')]: {
            'other-operation': {
              generation: 1,
              kind: 'chat',
              lane: 'lane-other',
              operationId: 'other-operation',
              sessionId: 'other-session',
              topicId: 'other-topic',
              userScope: 'user:account-a',
            },
          },
          [messageMapKey('session-id', 'topic-id')]: {
            'current-operation-one': {
              generation: 1,
              kind: 'chat',
              lane: 'lane-current-one',
              operationId: 'current-operation-one',
              sessionId: 'session-id',
              topicId: 'topic-id',
              userScope: 'user:account-a',
            },
            'current-operation-two': {
              generation: 1,
              kind: 'chat',
              lane: 'lane-current-two',
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
        [messageMapKey('other-session', 'other-topic')]: {
          'other-operation': {
            generation: 1,
            kind: 'chat',
            lane: 'lane-other',
            operationId: 'other-operation',
            sessionId: 'other-session',
            topicId: 'other-topic',
            userScope: 'user:account-a',
          },
        },
      });
      expect(cancel).not.toHaveBeenCalled();
    });

    it('keeps deferred browser-fallback loading controllers across a topic switch', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');
      const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
      const laneKey = conversationKey;
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        chatLoadingAbortControllersByLane: { [laneKey]: controller },
        chatLoadingIds: ['deferred-assistant'],
        chatLoadingIdsAbortController: controller,
        chatLoadingLaneByMessageId: { 'deferred-assistant': laneKey },
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'deferred-assistant',
            reason: 'unsupported_tool',
            toolName: 'lobe-code-interpreter',
          },
        },
      });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(abortSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().chatLoadingIds).toEqual(['deferred-assistant']);
      expect(useChatStore.getState().chatLoadingAbortControllersByLane[laneKey]).toBe(controller);
    });

    it('keeps deferred browser-fallback plugin abort controllers across a topic switch', () => {
      const deferredToolController = new AbortController();
      const otherToolController = new AbortController();
      const deferredAbortSpy = vi.spyOn(deferredToolController, 'abort');
      const otherAbortSpy = vi.spyOn(otherToolController, 'abort');
      const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'deferred-assistant',
            reason: 'unsupported_tool',
            toolName: 'lobe-image-designer',
          },
        },
        messagesMap: {
          [messageMapKey('session-id', 'topic-id')]: [
            { id: 'deferred-assistant', role: 'assistant' } as UIChatMessage,
            {
              id: 'deferred-tavily',
              parentId: 'deferred-assistant',
              role: 'tool',
            } as UIChatMessage,
          ],
          [messageMapKey('other-session', 'other-topic')]: [
            { id: 'other-assistant', role: 'assistant' } as UIChatMessage,
            { id: 'other-tool', parentId: 'other-assistant', role: 'tool' } as UIChatMessage,
          ],
        },
        pluginApiAbortControllers: {
          'deferred-tavily': deferredToolController,
          'other-tool': otherToolController,
        },
        pluginApiLoadingIds: ['deferred-tavily', 'other-tool'],
      });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(deferredAbortSpy).not.toHaveBeenCalled();
      expect(otherAbortSpy).toHaveBeenCalled();
      expect(useChatStore.getState().pluginApiLoadingIds).toEqual(['deferred-tavily']);
      expect(useChatStore.getState().pluginApiAbortControllers['deferred-tavily']).toBe(
        deferredToolController,
      );
      expect(useChatStore.getState().pluginApiAbortControllers['other-tool']).toBeUndefined();
    });

    it('keeps deferred RAG loading ids across a topic switch', () => {
      const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'deferred-assistant',
            reason: 'unsupported_tool',
            toolName: 'lobe-image-designer',
          },
        },
        messageRAGLoadingIds: ['deferred-user', 'other-user'],
        messagesMap: {
          [messageMapKey('session-id', 'topic-id')]: [
            { id: 'deferred-user', role: 'user' } as UIChatMessage,
            { id: 'deferred-assistant', role: 'assistant' } as UIChatMessage,
          ],
          [messageMapKey('other-session', 'other-topic')]: [
            { id: 'other-user', role: 'user' } as UIChatMessage,
          ],
        },
      });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(useChatStore.getState().messageRAGLoadingIds).toEqual(['deferred-user']);
    });

    it('logs preserved vs aborted in-flight ids for a deferred topic switch', () => {
      const logSpy = vi
        .spyOn(generationDebugClient, 'logDeferredGenerationLane')
        .mockResolvedValue();
      const deferredToolController = new AbortController();
      const otherToolController = new AbortController();
      const conversationKey = deferredBrowserGenerationLaneKey('session-id', 'topic-id', null);
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        chatLoadingIds: ['deferred-assistant', 'other-assistant'],
        deferredBrowserGenerationLanes: {
          [conversationKey]: {
            assistantMessageId: 'deferred-assistant',
            reason: 'unsupported_tool',
            spanId: 'gd_invalidate_span',
            toolName: 'lobe-image-designer',
          },
        },
        messageRAGLoadingIds: ['deferred-user', 'other-user'],
        messagesMap: {
          [messageMapKey('session-id', 'topic-id')]: [
            { id: 'deferred-user', role: 'user' } as UIChatMessage,
            { id: 'deferred-assistant', role: 'assistant' } as UIChatMessage,
            {
              id: 'deferred-tavily',
              parentId: 'deferred-assistant',
              role: 'tool',
            } as UIChatMessage,
          ],
        },
        pluginApiAbortControllers: {
          'deferred-tavily': deferredToolController,
          'other-tool': otherToolController,
        },
        searchWorkflowLoadingIds: ['other-search'],
      });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(logSpy).toHaveBeenCalledWith(
        'invalidate_preserved',
        expect.objectContaining({
          abortedChatCount: 1,
          abortedPluginCount: 1,
          abortedRagCount: 1,
          abortedSearchCount: 1,
          assistantMessageId: 'deferred-assistant',
          deferredLaneCount: 1,
          preservedChatCount: 1,
          preservedPluginCount: 1,
          preservedRagCount: 1,
          preservedSearchCount: 0,
          sessionId: 'session-id',
          spanId: 'gd_invalidate_span',
          topicId: 'topic-id',
        }),
      );
    });

    it('clears the RAG loading ids so a stuck avatar spinner cannot survive a switch', () => {
      useChatStore.setState({ chatLoadingIds: ['m1'], messageRAGLoadingIds: ['m1'] });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_invalidateConversation();
      });

      expect(useChatStore.getState().messageRAGLoadingIds).toEqual([]);
      expect(useChatStore.getState().chatLoadingIds).toEqual([]);
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
          [messageMapKey('session-id', 'topic-id')]: {
            'generation-operation': {
              generation: 1,
              kind: 'chat',
              lane: 'lane-generation',
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

    it('fences an in-flight durable send on the default topic so sync cancels it after clear', async () => {
      const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
      const listActive = vi
        .spyOn(conversationGenerationService, 'listActive')
        .mockResolvedValue([]);
      const defaultTopicKey = messageMapKey('session-id', null);
      const defaultLaneKey = `${defaultTopicKey}:main`;

      useChatStore.setState({
        activeTopicId: null,
        conversationLaneStopMarkers: {},
        durableInFlightEnqueues: {
          [defaultLaneKey]: [{ idempotencyKey: 'chat-send:temp-clear', kind: 'chat' }],
        },
        serverGenerationOperations: {},
      });

      await act(async () => {
        await useChatStore.getState().clearMessage();
      });

      // The destructive tombstone collects the in-flight key synchronously...
      expect(
        useChatStore.getState().conversationLaneStopMarkers[defaultTopicKey]
          ?.stoppedIdempotencyKeys,
      ).toContain('chat-send:temp-clear');

      // ...so when the operation only becomes visible to the server afterwards,
      // sync cancels it instead of reattaching it.
      listActive.mockResolvedValue([
        {
          id: 'cgo_after_clear',
          idempotencyKey: 'chat-send:temp-clear',
          kind: 'chat',
          lane: 'lane-late',
          laneGeneration: 1,
          sessionId: 'session-id',
          status: 'processing',
          topicId: null,
        },
      ] as any);

      await act(async () => {
        await useChatStore.getState().syncActiveConversationGenerations();
      });

      expect(cancel).toHaveBeenCalledWith('cgo_after_clear');
      expect(
        useChatStore.getState().serverGenerationOperations[defaultTopicKey]?.cgo_after_clear,
      ).toBeUndefined();
    });

    it('cancels a detached durable operation visible to the server during clearMessage', async () => {
      const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
        {
          id: 'cgo_detached_clear',
          idempotencyKey: 'chat-send:temp-detached-clear',
          kind: 'chat',
          lane: 'lane-detached',
          laneGeneration: 1,
          sessionId: 'session-id',
          status: 'processing',
          topicId: 'topic-id',
        },
      ] as any);

      useChatStore.setState({
        conversationLaneStopMarkers: {},
        durableInFlightEnqueues: {},
        serverGenerationOperations: {},
      });

      await act(async () => {
        await useChatStore.getState().clearMessage();
      });

      expect(cancel).toHaveBeenCalledWith('cgo_detached_clear');
      // The cancel scope resolves to the topic's main lane key.
      const laneMarkerKey = `${messageMapKey('session-id', 'topic-id')}:main`;
      expect(
        useChatStore.getState().conversationLaneStopMarkers[laneMarkerKey]?.stoppedIdempotencyKeys,
      ).toContain('chat-send:temp-detached-clear');
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

  describe('internal_updateMessageRAG', () => {
    it('refreshes the owning conversation after persist, even when another topic is active', async () => {
      const refreshMessages = vi.fn(() => Promise.resolve());
      useUserStore.setState({
        isUserStateInit: true,
        ownershipInvalidationGeneration: 0,
        userStateScope: 'current',
      });
      vi.spyOn(authSelectors, 'currentUserScope').mockReturnValue('current');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'other-topic',
        conversationClearGeneration: 0,
        conversationNavigationGeneration: 0,
        messagesMap: {
          [messageMapKey('session-id', 'topic-id')]: [
            {
              id: 'assistant-id',
              role: 'assistant',
              sessionId: 'session-id',
              topicId: 'topic-id',
            } as UIChatMessage,
          ],
        },
        refreshMessages,
      });

      await act(async () => {
        await result.current.internal_updateMessageRAG('assistant-id', {
          fileChunks: [{ id: 'chunk-1', similarity: 0.9 }],
          ragQueryId: 'query-1',
        });
      });

      expect(messageService.updateMessageRAG).toHaveBeenCalledWith('assistant-id', {
        fileChunks: [{ id: 'chunk-1', similarity: 0.9 }],
        ragQueryId: 'query-1',
      });
      expect(refreshMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-id',
          topicId: 'topic-id',
        }),
      );
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

    it('logs message_persist_skipped as hard_cancelled for a stale conversation generation', async () => {
      const logSpy = vi
        .spyOn(generationDebugClient, 'logDeferredGenerationLane')
        .mockResolvedValue();
      const updateSpy = vi.spyOn(messageService, 'updateMessage');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({ conversationClearGeneration: 4 });

      await act(async () => {
        await result.current.internal_updateMessageContent('message-id', 'search results', {
          conversationContext: {
            clearGeneration: 1,
            generation: 0,
            sessionId: 'session-id',
            topicId: 'topic-id',
          },
        });
      });

      expect(logSpy).toHaveBeenCalledWith(
        'message_persist_skipped',
        expect.objectContaining({
          reason: 'hard_cancelled',
        }),
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('persists when the captured fence matches the lane-scoped epoch and global stays 0', async () => {
      const updateSpy = vi.spyOn(messageService, 'updateMessage');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {
          [`${messageMapKey('session-id', 'topic-id')}:main`]: 1,
        },
      });

      await act(async () => {
        await result.current.internal_updateMessageContent('message-id', 'search results', {
          conversationContext: {
            clearGeneration: 1,
            generation: 0,
            sessionId: 'session-id',
            topicId: 'topic-id',
          },
        });
      });

      expect(updateSpy).toHaveBeenCalledWith('message-id', { content: 'search results' });
    });

    it('logs message_persist_skipped as hard_cancelled for a lane-scoped Stop', async () => {
      const logSpy = vi
        .spyOn(generationDebugClient, 'logDeferredGenerationLane')
        .mockResolvedValue();
      const updateSpy = vi.spyOn(messageService, 'updateMessage');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {
          [`${messageMapKey('session-id', 'topic-id')}:main`]: 1,
        },
      });

      await act(async () => {
        await result.current.internal_updateMessageContent('message-id', 'search results', {
          conversationContext: {
            clearGeneration: 0,
            generation: 0,
            sessionId: 'session-id',
            topicId: 'topic-id',
          },
        });
      });

      expect(logSpy).toHaveBeenCalledWith(
        'message_persist_skipped',
        expect.objectContaining({
          reason: 'hard_cancelled',
        }),
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('does not log message_persist_skipped when persisting a left-topic map row', async () => {
      const logSpy = vi
        .spyOn(generationDebugClient, 'logDeferredGenerationLane')
        .mockResolvedValue();
      const updateSpy = vi.spyOn(messageService, 'updateMessage');
      const { result } = renderHook(() => useChatStore());
      useChatStore.setState({
        activeId: 'session-id',
        activeTopicId: 'other-topic',
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
        messagesMap: {
          [messageMapKey('session-id', 'topic-id')]: [
            {
              id: 'left-topic-message',
              role: 'tool',
              sessionId: 'session-id',
              topicId: 'topic-id',
            } as UIChatMessage,
          ],
        },
      });

      await act(async () => {
        await result.current.internal_updateMessageContent('left-topic-message', 'search results');
      });

      expect(logSpy).not.toHaveBeenCalledWith('message_persist_skipped', expect.anything());
      expect(updateSpy).toHaveBeenCalledWith('left-topic-message', {
        content: 'search results',
      });
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

    it('reconciles triple ambiguity, restores the streamed final payload and classifies the failure', async () => {
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
      // server truth is stale — the write really did not land
      vi.mocked(messageService.getMessageById).mockResolvedValue({
        content: 'streamed…',
      } as any);
      const dispatchMessage = vi.fn();
      const refreshMessages = vi.fn();
      useChatStore.setState({ internal_dispatchMessage: dispatchMessage, refreshMessages });
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
        }),
      );

      expect(response).toEqual({
        failure: { bodyKind: 'html', httpStatus: 502 },
        persistenceAmbiguous: true,
      });
      expect(updateMessage).toHaveBeenCalledTimes(3);
      expect(reportClientRPCFailure).toHaveBeenCalledTimes(3);
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

    it('succeeds on the third attempt after two mangled responses', async () => {
      const gatewayError = new ToolsRPCResponseError({
        bodyKind: 'network_error',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 42,
        failurePhase: 'network',
        operation: 'finalize_assistant_message',
        reason: 'network_error',
      });
      const updateMessage = vi
        .spyOn(messageService, 'updateMessage')
        .mockRejectedValueOnce(gatewayError)
        .mockRejectedValueOnce(gatewayError)
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
        }),
      );

      expect(response).toEqual({ persistenceAmbiguous: false });
      expect(updateMessage).toHaveBeenCalledTimes(3);
      expect(reportClientRPCFailure).toHaveBeenCalledTimes(2);
    });

    it('recovers without ambiguity when the write landed but every response was lost', async () => {
      const gatewayError = new ToolsRPCResponseError({
        bodyKind: 'html',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 123,
        failurePhase: 'response_parse',
        httpStatus: 401,
        mediaType: 'text/html',
        operation: 'finalize_assistant_message',
        reason: 'response_parse_failed',
      });
      vi.spyOn(messageService, 'updateMessage').mockRejectedValue(gatewayError);
      // the server actually applied the update — only the responses were
      // mangled. The persisted row is GROUP-shaped (non-null groupId): the
      // id-scoped read must recover it (a conversation-list query would not).
      vi.mocked(messageService.getMessageById).mockResolvedValue({
        content: 'final content',
        groupId: 'group-1',
        tools: [{ id: 'call_ci_1' }],
      } as any);
      const refreshMessages = vi.fn();
      useChatStore.setState({ refreshMessages });
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
          toolCalls: [
            {
              function: { arguments: '{}', name: 'lobe-code-interpreter____python' },
              id: 'call_ci_1',
              type: 'function',
            },
          ],
        }),
      );

      expect(response).toEqual({ persistenceAmbiguous: false });
      // verified via the id-scoped read, not a bounded conversation-list query —
      // with the global error UI suppressed and the shared finalize diagnostic id
      expect(messageService.getMessageById).toHaveBeenCalledWith('message-id', {
        diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
        diagnosticOperation: 'finalize_assistant_message',
        showNotification: false,
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(refreshMessages).toHaveBeenCalledTimes(1);
    });

    it('stays ambiguous when any intended tool call is missing from the persisted message', async () => {
      const gatewayError = new ToolsRPCResponseError({
        bodyKind: 'html',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 123,
        failurePhase: 'response_parse',
        httpStatus: 403,
        mediaType: 'text/html',
        operation: 'finalize_assistant_message',
        reason: 'response_parse_failed',
      });
      vi.spyOn(messageService, 'updateMessage').mockRejectedValue(gatewayError);
      // content matches and ONE of two intended tool calls is present — the
      // tools update did NOT land completely, so recovery must not trigger
      vi.mocked(messageService.getMessageById).mockResolvedValue({
        content: 'final content',
        tools: [{ id: 'call_ci_1' }],
      } as any);
      useChatStore.setState({ refreshMessages: vi.fn() });
      const { result } = renderHook(() => useChatStore());

      const response = await act(async () =>
        result.current.internal_updateMessageContent('message-id', 'final content', {
          persistenceRecovery: 'assistant_finalization',
          toolCalls: [
            {
              function: { arguments: '{}', name: 'lobe-code-interpreter____python' },
              id: 'call_ci_1',
              type: 'function',
            },
            {
              function: { arguments: '{}', name: 'lobe-code-interpreter____python' },
              id: 'call_ci_2',
              type: 'function',
            },
          ],
        }),
      );

      expect(response).toEqual({
        failure: { bodyKind: 'html', httpStatus: 403 },
        persistenceAmbiguous: true,
      });
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

  describe('replaceMessages', () => {
    it('keeps chat Image file ids when a later snapshot is prompt-only', () => {
      const chatKey = messageMapKey(mockState.activeId, mockState.activeTopicId);
      useChatStore.setState({
        messagesMap: {
          [chatKey]: [
            {
              content: JSON.stringify([{ imageId: 'file-1', prompt: 'p', taskId: 't-1' }]),
              id: 'tool-1',
              plugin: { apiName: 'text2image', identifier: 'lobe-image-designer', type: 'builtin' },
              role: 'tool',
            } as UIChatMessage,
          ],
        },
      });

      useChatStore.getState().replaceMessages([
        {
          content: JSON.stringify([{ prompt: 'p' }]),
          id: 'tool-1',
          plugin: { apiName: 'text2image', identifier: 'lobe-image-designer', type: 'builtin' },
          role: 'tool',
        } as UIChatMessage,
      ]);

      expect(useChatStore.getState().messagesMap[chatKey][0].content).toContain(
        '"imageId":"file-1"',
      );
      expect(useChatStore.getState().messagesMap[chatKey][0].content).toContain('"taskId":"t-1"');
    });

    it('keeps chat Image file ids when the fetch row omitted plugin', () => {
      const chatKey = messageMapKey(mockState.activeId, mockState.activeTopicId);
      useChatStore.setState({
        messagesMap: {
          [chatKey]: [
            {
              content: JSON.stringify([{ imageId: 'file-1', prompt: 'p', taskId: 't-1' }]),
              id: 'tool-1',
              plugin: { apiName: 'text2image', identifier: 'lobe-image-designer', type: 'builtin' },
              role: 'tool',
            } as UIChatMessage,
          ],
        },
      });

      useChatStore.getState().replaceMessages([
        {
          content: JSON.stringify([{ prompt: 'p' }]),
          id: 'tool-1',
          role: 'tool',
        } as UIChatMessage,
      ]);

      expect(useChatStore.getState().messagesMap[chatKey][0].content).toContain(
        '"imageId":"file-1"',
      );
    });

    it('keeps a newer Retry tuple when a fetched snapshot is a stale Stop', () => {
      const chatKey = messageMapKey(mockState.activeId, mockState.activeTopicId);
      useChatStore.setState({
        messagesMap: {
          [chatKey]: [
            {
              content: JSON.stringify([
                {
                  prompt: 'p',
                  taskAttempt: 1,
                  taskFence: 2,
                  taskId: '22222222-2222-4222-8222-222222222222',
                },
              ]),
              id: 'tool-1',
              plugin: { apiName: 'text2image', identifier: 'lobe-image-designer', type: 'builtin' },
              role: 'tool',
            } as UIChatMessage,
          ],
        },
      });

      useChatStore.getState().replaceMessages([
        {
          content: JSON.stringify([
            {
              prompt: 'p',
              taskAttempt: 0,
              taskCancelled: true,
              taskFence: 1,
              taskId: '11111111-1111-4111-8111-111111111111',
            },
          ]),
          id: 'tool-1',
          plugin: { apiName: 'text2image', identifier: 'lobe-image-designer', type: 'builtin' },
          role: 'tool',
        } as UIChatMessage,
      ]);

      const parsed = JSON.parse(useChatStore.getState().messagesMap[chatKey][0].content) as {
        taskAttempt?: number;
        taskCancelled?: boolean;
        taskId?: string;
      }[];
      expect(parsed[0]?.taskId).toBe('22222222-2222-4222-8222-222222222222');
      expect(parsed[0]?.taskAttempt).toBe(1);
      expect(parsed[0]?.taskCancelled).toBeUndefined();
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
