import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/const/settings';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useSessionStore } from '@/store/session';
import { authSelectors } from '@/store/user/selectors';
import { UploadFileItem } from '@/types/files/upload';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { TEST_CONTENT, TEST_IDS, createMockStoreState } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

// Mock server mode for V2 tests
vi.mock('@/const/version', async (importOriginal) => {
  const module = await importOriginal();
  return {
    ...(module as any),
    isDesktop: false,
    isServerMode: true,
  };
});

// Mock aiChatService for V2 server flow
vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    sendMessageInServer: vi.fn(async (params: any) => {
      const userId = TEST_IDS.USER_MESSAGE_ID;
      const assistantId = TEST_IDS.ASSISTANT_MESSAGE_ID;
      const topicId = params.topicId ?? TEST_IDS.TOPIC_ID;
      return {
        assistantMessageId: assistantId,
        isCreateNewTopic: !params.topicId,
        messages: [
          {
            content: params.newUserMessage?.content ?? '',
            id: userId,
            role: 'user',
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
          {
            content: LOADING_FLAT,
            id: assistantId,
            role: 'assistant',
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
        ],
        topicId,
        topics: [],
        userMessageId: userId,
      } as any;
    }),
  },
}));

const realExecAgentRuntime = useChatStore.getState().internal_execAgentRuntime;
const createDeferred = <Value>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
};

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();

  // Setup default spies that most tests need
  spyOnMessageService();

  // Setup common mock methods that most V2 tests need
  act(() => {
    useSessionStore.setState({ triggerSessionUpdate: vi.fn() });
    useChatStore.setState({
      activeId: TEST_IDS.SESSION_ID,
      activeTopicId: TEST_IDS.TOPIC_ID,
      internal_execAgentRuntime: vi.fn(),
      mainSendMessageOperations: {},
      refreshMessages: vi.fn(() => Promise.resolve()),
      refreshTopic: vi.fn(() => Promise.resolve()),
      saveToTopic: vi.fn(),
      switchTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = undefined;
  vi.restoreAllMocks();
});

describe('generateAIChatV2 actions', () => {
  describe('internal_refreshAiChat', () => {
    it('normalizes and replaces topics returned after an existing-topic send', () => {
      const { result } = renderHook(() => useChatStore());
      const latestActivity = new Date('2026-07-21T16:00:00.000Z');

      act(() => {
        result.current.internal_refreshAiChat({
          messages: [],
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
          topics: [
            {
              createdAt: new Date('2026-07-20T16:00:00.000Z'),
              id: TEST_IDS.TOPIC_ID,
              lastActivityAt: latestActivity,
              title: 'Updated topic',
              updatedAt: latestActivity,
            } as any,
          ],
        });
      });

      expect(useChatStore.getState().topicMaps[TEST_IDS.SESSION_ID]).toEqual([
        expect.objectContaining({
          id: TEST_IDS.TOPIC_ID,
          lastActivityAt: latestActivity.getTime(),
          updatedAt: latestActivity.getTime(),
        }),
      ]);
    });
  });

  describe('sendMessageInServer', () => {
    it('ignores a persistence response after switching conversations', async () => {
      let resolveServerSend: (response: any) => void;
      const serverSendPromise = new Promise<any>((resolve) => {
        resolveServerSend = resolve;
      });
      (aiChatService.sendMessageInServer as Mock).mockReturnValueOnce(serverSendPromise);
      const refreshAiChat = vi.fn();
      const execAgentRuntime = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: execAgentRuntime,
          internal_refreshAiChat: refreshAiChat,
        });
      });

      const sendPromise = useChatStore
        .getState()
        .sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
      await Promise.resolve();

      act(() => {
        useChatStore.getState().internal_updateActiveId('other-session');
      });

      resolveServerSend!({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: false,
        messages: [],
        topicId: TEST_IDS.TOPIC_ID,
        topics: [],
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });
      await sendPromise;

      expect(refreshAiChat).not.toHaveBeenCalled();
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    describe('validation', () => {
      it('should not send when there is no active session', async () => {
        act(() => {
          useChatStore.setState({ activeId: undefined });
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should not send when message is empty and no files are provided', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
      });

      it('should not send when message is empty with empty files array', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ files: [], message: TEST_CONTENT.EMPTY });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
      });
    });

    describe('message creation', () => {
      it('should create user message and trigger AI processing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            expectedConversationVersion: 7,
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newTopic: undefined,
            newUserMessage: {
              content: TEST_CONTENT.USER_MESSAGE,
              files: undefined,
            },
            sessionId: TEST_IDS.SESSION_ID,
            threadId: undefined,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('should skip creating new topic when auto-create topic is disabled', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          enableAutoCreateTopic: false,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'disable auto create' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toBeUndefined();
      });

      it('should include newTopic payload when auto-create topic is enabled and threshold is reached', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          autoCreateTopicThreshold: 1,
          enableAutoCreateTopic: true,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'auto create topic' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toMatchObject({
          topicMessageIds: [],
        });
      });

      it('should not create new topic when threshold is not reached', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          autoCreateTopicThreshold: 10,
          enableAutoCreateTopic: true,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'threshold not met' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toBeUndefined();
      });

      it('should send message with files attached', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ files, message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            expectedConversationVersion: 7,
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newTopic: undefined,
            newUserMessage: {
              content: TEST_CONTENT.USER_MESSAGE,
              files: [TEST_IDS.FILE_ID],
            },
            sessionId: TEST_IDS.SESSION_ID,
            threadId: undefined,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
      });

      it('should send files without message content', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ files, message: TEST_CONTENT.EMPTY });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            expectedConversationVersion: 7,
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newTopic: undefined,
            newUserMessage: {
              content: TEST_CONTENT.EMPTY,
              files: [TEST_IDS.FILE_ID],
            },
            sessionId: TEST_IDS.SESSION_ID,
            threadId: undefined,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
      });

      it('should not process AI when onlyAddUserMessage is true', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            onlyAddUserMessage: true,
          });
        });

        expect(messageService.createMessage).toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should handle message creation errors gracefully', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new Error('create message error'),
        );

        await act(async () => {
          try {
            await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
          } catch {
            // Expected to throw
          }
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('keeps context export armed when server persistence fails', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new Error('create message error'),
        );

        act(() => {
          result.current.armContextExport();
        });

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(result.current.contextExportCaptureStatus).toBe('armed');
        expect(result.current.contextExportBatch).toBeUndefined();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('does not attach files after account scope changes during runtime', async () => {
        const runtimeDeferred = createDeferred<void>();
        const addFilesToAgent = vi.fn().mockResolvedValue(undefined);
        let currentUserScope = 'user:account-a';
        vi.spyOn(authSelectors, 'currentUserScope').mockImplementation(() => currentUserScope);
        vi.spyOn(useAgentStore.getState(), 'addFilesToAgent').mockImplementation(addFilesToAgent);
        useChatStore.setState({
          internal_execAgentRuntime: vi.fn().mockReturnValue(runtimeDeferred.promise),
        });
        const { result } = renderHook(() => useChatStore());

        let sendPromise!: Promise<void>;
        act(() => {
          sendPromise = result.current.sendMessage({
            files: [{ id: TEST_IDS.FILE_ID } as UploadFileItem],
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });
        await vi.waitFor(() => {
          expect(Object.keys(useChatStore.getState().serverGenerationOperations)).toHaveLength(1);
        });

        currentUserScope = 'user:account-b';
        runtimeDeferred.resolve(undefined);
        await act(async () => {
          await sendPromise;
        });

        expect(addFilesToAgent).not.toHaveBeenCalled();
        expect(useChatStore.getState().serverGenerationOperations).toEqual({});
      });

      it('does not attach files after switching away and back during runtime', async () => {
        const runtimeDeferred = createDeferred<void>();
        const addFilesToAgent = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(useAgentStore.getState(), 'addFilesToAgent').mockImplementation(addFilesToAgent);
        useChatStore.setState({
          internal_execAgentRuntime: vi.fn().mockReturnValue(runtimeDeferred.promise),
        });
        const { result } = renderHook(() => useChatStore());

        let sendPromise!: Promise<void>;
        act(() => {
          sendPromise = result.current.sendMessage({
            files: [{ id: TEST_IDS.FILE_ID } as UploadFileItem],
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });
        await vi.waitFor(() => {
          expect(Object.keys(useChatStore.getState().serverGenerationOperations)).toHaveLength(1);
        });

        act(() => {
          useChatStore.setState({
            activeId: 'other-session',
            conversationClearGeneration: 1,
          });
          useChatStore.setState({ activeId: TEST_IDS.SESSION_ID });
        });
        runtimeDeferred.resolve(undefined);
        await act(async () => {
          await sendPromise;
        });

        expect(addFilesToAgent).not.toHaveBeenCalled();
        expect(useChatStore.getState().serverGenerationOperations).toEqual({});
      });

      it('keeps a same-topic sibling operation when the older runtime completes first', async () => {
        const olderRuntime = createDeferred<void>();
        const newerRuntime = createDeferred<void>();
        const internal_execAgentRuntime = vi
          .fn()
          .mockReturnValueOnce(olderRuntime.promise)
          .mockReturnValueOnce(newerRuntime.promise);
        useChatStore.setState({ internal_execAgentRuntime });
        const { result } = renderHook(() => useChatStore());
        const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

        let olderPromise!: Promise<void>;
        act(() => {
          olderPromise = result.current.sendMessage({ message: 'Older request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(1);
        });
        const [olderOperationId] = Object.keys(
          useChatStore.getState().serverGenerationOperations[operationKey],
        );

        let newerPromise!: Promise<void>;
        act(() => {
          newerPromise = result.current.sendMessage({ message: 'Newer request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(2);
        });
        const newerOperationId = Object.keys(
          useChatStore.getState().serverGenerationOperations[operationKey],
        ).find((operationId) => operationId !== olderOperationId);

        olderRuntime.resolve(undefined);
        await act(async () => {
          await olderPromise;
        });

        expect(
          Object.keys(useChatStore.getState().serverGenerationOperations[operationKey]),
        ).toEqual([newerOperationId]);

        newerRuntime.resolve(undefined);
        await act(async () => {
          await newerPromise;
        });

        expect(useChatStore.getState().serverGenerationOperations[operationKey]).toBeUndefined();
      });

      it('keeps a same-topic sibling operation when the newer runtime completes first', async () => {
        const olderRuntime = createDeferred<void>();
        const newerRuntime = createDeferred<void>();
        useChatStore.setState({
          internal_execAgentRuntime: vi
            .fn()
            .mockReturnValueOnce(olderRuntime.promise)
            .mockReturnValueOnce(newerRuntime.promise),
        });
        const { result } = renderHook(() => useChatStore());
        const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

        let olderPromise!: Promise<void>;
        let newerPromise!: Promise<void>;
        act(() => {
          olderPromise = result.current.sendMessage({ message: 'Older request' });
          newerPromise = result.current.sendMessage({ message: 'Newer request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(2);
        });
        const operationIds = Object.keys(
          useChatStore.getState().serverGenerationOperations[operationKey],
        );

        newerRuntime.resolve(undefined);
        await act(async () => {
          await newerPromise;
        });

        expect(
          Object.keys(useChatStore.getState().serverGenerationOperations[operationKey]),
        ).toEqual([operationIds[0]]);

        olderRuntime.resolve(undefined);
        await act(async () => {
          await olderPromise;
        });

        expect(useChatStore.getState().serverGenerationOperations[operationKey]).toBeUndefined();
      });

      it('removes only a rejected same-topic runtime operation', async () => {
        const rejectedRuntime = createDeferred<void>();
        const activeRuntime = createDeferred<void>();
        useChatStore.setState({
          internal_execAgentRuntime: vi
            .fn()
            .mockReturnValueOnce(rejectedRuntime.promise)
            .mockReturnValueOnce(activeRuntime.promise),
        });
        const { result } = renderHook(() => useChatStore());
        const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

        let rejectedPromise!: Promise<void>;
        let activePromise!: Promise<void>;
        act(() => {
          rejectedPromise = result.current.sendMessage({ message: 'Rejected request' });
          activePromise = result.current.sendMessage({ message: 'Active request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(2);
        });
        const operationIds = Object.keys(
          useChatStore.getState().serverGenerationOperations[operationKey],
        );

        rejectedRuntime.reject(new Error('runtime failed'));
        await act(async () => {
          await rejectedPromise;
        });

        expect(
          Object.keys(useChatStore.getState().serverGenerationOperations[operationKey]),
        ).toEqual([operationIds[1]]);

        activeRuntime.resolve(undefined);
        await act(async () => {
          await activePromise;
        });

        expect(useChatStore.getState().serverGenerationOperations[operationKey]).toBeUndefined();
      });

      it('does not remove a new same-key operation after invalidation', async () => {
        const staleRuntime = createDeferred<void>();
        const currentRuntime = createDeferred<void>();
        useChatStore.setState({
          internal_execAgentRuntime: vi
            .fn()
            .mockReturnValueOnce(staleRuntime.promise)
            .mockReturnValueOnce(currentRuntime.promise),
        });
        const { result } = renderHook(() => useChatStore());
        const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);

        let stalePromise!: Promise<void>;
        act(() => {
          stalePromise = result.current.sendMessage({ message: 'Stale request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(1);
        });

        act(() => {
          result.current.internal_invalidateConversation();
        });
        expect(useChatStore.getState().serverGenerationOperations[operationKey]).toBeUndefined();

        let currentPromise!: Promise<void>;
        act(() => {
          currentPromise = result.current.sendMessage({ message: 'Current request' });
        });
        await vi.waitFor(() => {
          expect(
            Object.keys(useChatStore.getState().serverGenerationOperations[operationKey] || {}),
          ).toHaveLength(1);
        });
        const [currentOperationId] = Object.keys(
          useChatStore.getState().serverGenerationOperations[operationKey],
        );

        staleRuntime.resolve(undefined);
        await act(async () => {
          await stalePromise;
        });

        expect(
          Object.keys(useChatStore.getState().serverGenerationOperations[operationKey]),
        ).toEqual([currentOperationId]);

        currentRuntime.resolve(undefined);
        await act(async () => {
          await currentPromise;
        });

        expect(useChatStore.getState().serverGenerationOperations[operationKey]).toBeUndefined();
      });
    });

    describe('RAG integration', () => {
      it('should include RAG query when RAG is enabled', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(true);

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.RAG_QUERY });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            ragQuery: TEST_CONTENT.RAG_QUERY,
          }),
        );
      });

      it('should not use RAG when feature is disabled', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(false);
        const retrieveChunksSpy = vi.spyOn(result.current, 'internal_retrieveChunks');

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(retrieveChunksSpy).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            ragQuery: undefined,
          }),
        );
      });
    });

    describe('special flags', () => {
      it('should pass isWelcomeQuestion flag to processing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            isWelcomeQuestion: true,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            isWelcomeQuestion: true,
          }),
        );
      });
    });
  });

  describe('internal_execAgentRuntime', () => {
    it('should handle the core AI message processing', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        content: TEST_CONTENT.USER_MESSAGE,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      const messages = [userMessage];

      const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream');

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          userMessageId: userMessage.id,
        });
      });

      expect(streamSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should set error message when sendMessageInServer throws a regular error', async () => {
      const { result } = renderHook(() => useChatStore());
      const errorMessage = 'Network error';
      const mockError = new TRPCClientError(errorMessage);
      (mockError as any).data = { code: 'BAD_REQUEST' };

      vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(mockError);

      await act(async () => {
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
      expect(result.current.mainSendMessageOperations[operationKey]?.inputSendErrorMsg).toBe(
        errorMessage,
      );
    });

    it('should not set error message when receiving a cancel signal', async () => {
      const { result } = renderHook(() => useChatStore());
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';

      vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(abortError);

      await act(async () => {
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
      expect(
        result.current.mainSendMessageOperations[operationKey]?.inputSendErrorMsg,
      ).toBeUndefined();
    });
  });

  describe('topic creation and switching', () => {
    it('should remove temporary message when creating new topic in default state', async () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValueOnce({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: true,
        messages: [{}, {}] as any,
        topicId: TEST_IDS.TOPIC_ID,
        topics: [{}] as any,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: undefined,
          messagesMap: {},
          switchTopic: vi.fn(async (topicId) => {
            useChatStore.setState({ activeTopicId: topicId });
          }),
        });

        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(useChatStore.getState().messagesMap[`${TEST_IDS.SESSION_ID}_null`]).toEqual([]);
    });

    it('should automatically switch to newly created topic when no active topic exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockSwitchTopic = vi.fn();

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: undefined,
          switchTopic: mockSwitchTopic,
        });
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(mockSwitchTopic).toHaveBeenCalledWith(TEST_IDS.TOPIC_ID, true);
    });

    it('should not switch topic when active topic already exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockSwitchTopic = vi.fn();

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          switchTopic: mockSwitchTopic,
        });
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(mockSwitchTopic).not.toHaveBeenCalled();
    });
  });

  describe('cancelSendMessageInServer', () => {
    it('should abort operation and restore editor state when cancelling', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const mockSetJSONState = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainInputEditor: { setJSONState: mockSetJSONState } as any,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: {
              abortController: { abort: mockAbort, signal: {} as any },
              inputEditorTempState: { content: 'saved content' },
              isLoading: true,
            },
          },
        });
      });

      act(() => {
        result.current.cancelSendMessageInServer();
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
      expect(
        result.current.mainSendMessageOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ]?.isLoading,
      ).toBe(false);
      expect(mockSetJSONState).toHaveBeenCalledWith({ content: 'saved content' });
    });

    it('should cancel operation for specified topic ID', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const customTopicId = 'custom-topic-id';

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, customTopicId)]: {
              abortController: { abort: mockAbort, signal: {} as any },
              isLoading: true,
            },
          },
        });
      });

      act(() => {
        result.current.cancelSendMessageInServer(customTopicId);
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
    });

    it('should handle gracefully when operation does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ mainSendMessageOperations: {} });
      });

      expect(() => {
        act(() => {
          result.current.cancelSendMessageInServer('non-existing-topic');
        });
      }).not.toThrow();
    });
  });

  describe('clearSendMessageError', () => {
    it('should clear error state for current topic', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: {
              inputSendErrorMsg: 'Some error',
              isLoading: false,
            },
          },
        });
      });

      act(() => {
        result.current.clearSendMessageError();
      });

      expect(
        result.current.mainSendMessageOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ],
      ).toBeUndefined();
    });

    it('should handle gracefully when no error operation exists', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ mainSendMessageOperations: {} });
      });

      expect(() => {
        act(() => {
          result.current.clearSendMessageError();
        });
      }).not.toThrow();
    });
  });

  describe('internal_toggleSendMessageOperation', () => {
    it('should create new send operation with abort controller', () => {
      const { result } = renderHook(() => useChatStore());
      let abortController: AbortController | undefined;

      act(() => {
        abortController = result.current.internal_toggleSendMessageOperation('test-key', true);
      });

      expect(abortController!).toBeInstanceOf(AbortController);
      expect(result.current.mainSendMessageOperations['test-key']?.isLoading).toBe(true);
      expect(result.current.mainSendMessageOperations['test-key']?.abortController).toBe(
        abortController,
      );
    });

    it('should stop send operation and clear abort controller', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = { abort: vi.fn() } as any;

      let abortController: AbortController | undefined;
      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          abortController: mockAbortController,
          isLoading: true,
        });

        abortController = result.current.internal_toggleSendMessageOperation('test-key', false);
      });

      expect(abortController).toBeUndefined();
      expect(result.current.mainSendMessageOperations['test-key']?.isLoading).toBe(false);
      expect(result.current.mainSendMessageOperations['test-key']?.abortController).toBeNull();
    });

    it('should call abort with cancel reason when stopping', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = { abort: vi.fn() } as any;

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          abortController: mockAbortController,
          isLoading: true,
        });

        result.current.internal_toggleSendMessageOperation('test-key', false, 'Test cancel reason');
      });

      expect(mockAbortController.abort).toHaveBeenCalledWith('Test cancel reason');
    });

    it('should support multiple parallel operations', () => {
      const { result } = renderHook(() => useChatStore());

      let abortController1, abortController2;
      act(() => {
        abortController1 = result.current.internal_toggleSendMessageOperation('key1', true);
        abortController2 = result.current.internal_toggleSendMessageOperation('key2', true);
      });

      expect(result.current.mainSendMessageOperations['key1']?.isLoading).toBe(true);
      expect(result.current.mainSendMessageOperations['key2']?.isLoading).toBe(true);
      expect(abortController1).not.toBe(abortController2);
    });
  });

  describe('internal_updateSendMessageOperation', () => {
    it('should update operation state', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = new AbortController();

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          abortController: mockAbortController,
          inputSendErrorMsg: 'test error',
          isLoading: true,
        });
      });

      expect(result.current.mainSendMessageOperations['test-key']).toEqual({
        abortController: mockAbortController,
        inputSendErrorMsg: 'test error',
        isLoading: true,
      });
    });

    it('should support partial update of operation state', () => {
      const { result } = renderHook(() => useChatStore());
      const initialController = new AbortController();

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          abortController: initialController,
          isLoading: true,
        });

        result.current.internal_updateSendMessageOperation('test-key', {
          inputSendErrorMsg: 'new error',
        });
      });

      expect(result.current.mainSendMessageOperations['test-key']).toEqual({
        abortController: initialController,
        inputSendErrorMsg: 'new error',
        isLoading: true,
      });
    });
  });
});
