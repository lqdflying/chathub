import { ChatErrorType, UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/const/settings';
import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { ragService } from '@/services/rag';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors } from '@/store/aiInfra';
import { aiChatSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { getSkillSelectionKey, useSkillStore } from '@/store/skill';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { UploadFileItem } from '@/types/files/upload';
import { encodeAsync } from '@/utils/tokenizer';
import { estimatedEncodeAsync } from '@/utils/tokenizer/estimated';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { TEST_CONTENT, TEST_IDS, createMockStoreState } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/utils/tokenizer', () => ({
  MAX_EXACT_TOKENIZER_INPUT_LENGTH: 10_000,
  encodeAsync: vi.fn(async (text: string) => Math.ceil(text.length / 4)),
}));

vi.mock('@/utils/tokenizer/estimated', () => ({
  estimatedEncodeAsync: vi.fn(async (text: string) => Math.ceil(text.length / 4)),
}));

vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  isClientDurableConversationGenerationEnabled: vi.fn(() => false),
}));

// Mock aiChatService for V2 server flow
vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    createAssistantMessageInServer: vi.fn(async (params: any) => {
      const topicId = params.topicId ?? TEST_IDS.TOPIC_ID;
      return {
        messages: [
          {
            content: TEST_CONTENT.USER_MESSAGE,
            id: params.parentId,
            role: 'user',
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
          {
            content: LOADING_FLAT,
            id: params.assistantMessageId,
            parentId: params.parentId,
            role: 'assistant',
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
        ],
      };
    }),
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
  useSkillStore.setState({ selectedSkillIdsByConversation: {} });
  vi.stubGlobal('Worker', class TokenizerWorker {});

  // Setup default spies that most tests need
  spyOnMessageService();
  vi.spyOn(conversationGenerationService, 'getOperation').mockResolvedValue({
    status: 'processing',
  } as any);
  vi.spyOn(conversationGenerationService, 'getOperationByIdempotencyKey').mockResolvedValue(
    undefined,
  );
  vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
  vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

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
  vi.unstubAllGlobals();
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
    it('does not send or change local state during an active owner mismatch', async () => {
      vi.spyOn(authSelectors, 'hasActiveUserStateOwnerMismatch').mockReturnValue(true);
      const messagesBefore = useChatStore.getState().messagesMap;

      await useChatStore.getState().sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });

      expect(aiChatService.sendMessageInServer).not.toHaveBeenCalled();
      expect(useChatStore.getState().messagesMap).toBe(messagesBefore);
      expect(useChatStore.getState().mainSendMessageOperations).toEqual({});
    });

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

      expect(refreshAiChat).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    it('does not attach a durable operation after account scope changes during send', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      let resolveServerSend: (response: any) => void;
      const serverSendPromise = new Promise<any>((resolve) => {
        resolveServerSend = resolve;
      });
      (aiChatService.sendMessageInServer as Mock).mockReturnValueOnce(serverSendPromise);
      const execAgentRuntime = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: execAgentRuntime,
        });
      });

      const sendPromise = useChatStore
        .getState()
        .sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
      await Promise.resolve();

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      });

      resolveServerSend!({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: false,
        messages: [],
        operationId: 'cgo_account_reset',
        topicId: TEST_IDS.TOPIC_ID,
        topics: [],
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });
      await sendPromise;

      expect(
        useChatStore.getState().serverGenerationOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ],
      ).toBeUndefined();
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    it('attaches a durable operation after switching conversations', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      let resolveServerSend: (response: any) => void;
      const serverSendPromise = new Promise<any>((resolve) => {
        resolveServerSend = resolve;
      });
      (aiChatService.sendMessageInServer as Mock).mockReturnValueOnce(serverSendPromise);
      const execAgentRuntime = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: execAgentRuntime,
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
        messages: [
          {
            content: TEST_CONTENT.USER_MESSAGE,
            id: TEST_IDS.USER_MESSAGE_ID,
            role: 'user',
          },
        ],
        operationId: 'cgo_left_during_send',
        topicId: TEST_IDS.TOPIC_ID,
        topics: [],
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });
      await sendPromise;

      expect(
        useChatStore.getState().serverGenerationOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ]['cgo_left_during_send'],
      ).toEqual(
        expect.objectContaining({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          clearGeneration: useChatStore.getState().conversationClearGeneration,
          generation: useChatStore.getState().conversationNavigationGeneration,
          operationId: 'cgo_left_during_send',
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
          userScope: 'current',
        }),
      );
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    it('tracks the durable enqueue idempotency key only while the send is in flight', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      let resolveServerSend: (response: any) => void;
      const serverSendPromise = new Promise<any>((resolve) => {
        resolveServerSend = resolve;
      });
      (aiChatService.sendMessageInServer as Mock).mockReturnValueOnce(serverSendPromise);

      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: vi.fn() });
      });

      const sendPromise = useChatStore
        .getState()
        .sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
      await vi.waitFor(() => {
        expect(aiChatService.sendMessageInServer).toHaveBeenCalled();
      });

      const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;
      const inFlight = useChatStore.getState().durableInFlightEnqueues[laneKey] ?? [];
      expect(inFlight.some((entry) => entry.idempotencyKey.startsWith('chat-send:'))).toBe(true);
      expect(inFlight[0]?.kind).toBe('chat');

      resolveServerSend!({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: false,
        messages: [],
        operationId: 'cgo_tracked',
        topicId: TEST_IDS.TOPIC_ID,
        topics: [],
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });
      await sendPromise;

      expect(useChatStore.getState().durableInFlightEnqueues[laneKey] ?? []).toHaveLength(0);
    });

    it('cancels an orphaned operation when Stop fences the source lane during auto-topic creation', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
      let resolveServerSend: (response: any) => void;
      const serverSendPromise = new Promise<any>((resolve) => {
        resolveServerSend = resolve;
      });
      (aiChatService.sendMessageInServer as Mock).mockReturnValueOnce(serverSendPromise);
      const execAgentRuntime = vi.fn();

      act(() => {
        useChatStore.setState({
          activeTopicId: null,
          internal_execAgentRuntime: execAgentRuntime,
          switchTopic: vi.fn(async (id: string) => {
            useChatStore.setState({ activeTopicId: id });
          }),
        });
      });

      const sendPromise = useChatStore
        .getState()
        .sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
      await vi.waitFor(() => {
        expect(aiChatService.sendMessageInServer).toHaveBeenCalled();
      });

      // Stop while the auto-create send is in flight: bumps the SOURCE (default
      // topic) lane epoch and records the in-flight idempotency key there.
      await act(async () => {
        await useChatStore.getState().stopGenerateMessage();
      });

      // The server commits the new topic and operation just before the abort
      // reaches it; the response relocates the context to the new topic id.
      resolveServerSend!({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: true,
        messages: [],
        operationId: 'cgo_auto_topic',
        topicId: TEST_IDS.NEW_TOPIC_ID,
        topics: [],
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });
      await sendPromise;

      // The relocated context no longer matches the fenced source lane, so the
      // orphaned server operation is cancelled instead of attached.
      expect(cancel).toHaveBeenCalledWith('cgo_auto_topic');
      expect(
        useChatStore.getState().serverGenerationOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.NEW_TOPIC_ID)
        ]?.cgo_auto_topic,
      ).toBeUndefined();
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    it('recovers a durable operation when send is aborted without a user Stop', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      (aiChatService.sendMessageInServer as Mock).mockRejectedValueOnce(abortError);
      vi.spyOn(conversationGenerationService, 'getOperationByIdempotencyKey').mockResolvedValueOnce(
        {
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          id: 'cgo_recovered',
          kind: 'chat',
          topicId: TEST_IDS.TOPIC_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any,
      );
      const execAgentRuntime = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: execAgentRuntime,
        });
      });

      await act(async () => {
        await useChatStore.getState().sendMessageInServer({
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      expect(conversationGenerationService.getOperationByIdempotencyKey).toHaveBeenCalled();
      expect(
        useChatStore.getState().serverGenerationOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ].cgo_recovered,
      ).toEqual(
        expect.objectContaining({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'cgo_recovered',
        }),
      );
      expect(execAgentRuntime).not.toHaveBeenCalled();
    });

    it('does not recover a durable operation after an explicit user cancel', async () => {
      vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
      vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
        () => () => false,
      );
      const abortError = new Error('canceled');
      abortError.name = 'AbortError';
      (aiChatService.sendMessageInServer as Mock).mockImplementationOnce((_params, controller) => {
        controller?.abort('canceled');
        return Promise.reject(abortError);
      });

      await act(async () => {
        await useChatStore.getState().sendMessageInServer({
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      expect(conversationGenerationService.getOperationByIdempotencyKey).not.toHaveBeenCalled();
      expect(
        useChatStore.getState().serverGenerationOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ],
      ).toBeUndefined();
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

    describe('pre-send compaction', () => {
      const realTriggerCompaction = useChatStore.getState().triggerTokenThresholdMemoryCompaction;
      const realDeleteMessage = useChatStore.getState().internal_deleteMessage;

      afterEach(() => {
        act(() => {
          useChatStore.setState({
            internal_deleteMessage: realDeleteMessage,
            triggerTokenThresholdMemoryCompaction: realTriggerCompaction,
          });
        });
      });

      it('registers a fresh stoppable AbortController while compaction runs and clears it', async () => {
        let compactingDuringRun = false;
        const compactionSpy = vi.fn(async () => {
          compactingDuringRun = aiChatSelectors.isCurrentPreSendCompacting(useChatStore.getState());
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactionSpy).toHaveBeenCalledWith(expect.any(AbortController));
        expect(compactingDuringRun).toBe(true);
        expect(result.current.preSendCompactionOperations).toEqual({});
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('skips placeholder creation and agent runtime when compaction is aborted', async () => {
        const internal_deleteMessage = vi.fn(() => Promise.resolve());
        const compactionSpy = vi.fn(async () => {
          await useChatStore.getState().stopGenerateMessage();
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({
            internal_deleteMessage,
            triggerTokenThresholdMemoryCompaction: compactionSpy,
          });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
        expect(aiChatService.createAssistantMessageInServer).not.toHaveBeenCalled();
        expect(internal_deleteMessage).not.toHaveBeenCalled();
        expect(result.current.preSendCompactionOperations).toEqual({});
      });

      it('does not create a placeholder after the user navigates away mid-abort', async () => {
        const internal_deleteMessage = vi.fn(() => Promise.resolve());
        const compactionSpy = vi.fn(async () => {
          await useChatStore.getState().stopGenerateMessage();
          useChatStore.setState({ activeTopicId: 'another-topic' });
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({
            internal_deleteMessage,
            triggerTokenThresholdMemoryCompaction: compactionSpy,
          });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessageInServer({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
        expect(aiChatService.createAssistantMessageInServer).not.toHaveBeenCalled();
        expect(internal_deleteMessage).not.toHaveBeenCalled();
      });

      it('does not create a placeholder after account ownership changes during compaction', async () => {
        const compactionDeferred = createDeferred<any>();
        let currentUserScope = 'user:account-a';
        useUserStore.setState({ isUserStateInit: true, userStateScope: currentUserScope });
        vi.spyOn(authSelectors, 'currentUserScope').mockImplementation(() => currentUserScope);
        const compactionSpy = vi.fn(() => compactionDeferred.promise);
        useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        const { result } = renderHook(() => useChatStore());

        let sendPromise!: Promise<void>;
        act(() => {
          sendPromise = result.current.sendMessageInServer({
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });
        await vi.waitFor(() => expect(compactionSpy).toHaveBeenCalled());

        currentUserScope = 'user:account-b';
        useUserStore.setState({ userStateScope: currentUserScope });
        compactionDeferred.resolve({ status: 'ineligible' });
        await act(async () => {
          await sendPromise;
        });

        expect(aiChatService.createAssistantMessageInServer).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
        currentUserScope = 'user:account-a';
        useUserStore.setState({ userStateScope: currentUserScope });
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
        expect(aiChatService.createAssistantMessageInServer).toHaveBeenCalledWith(
          {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            expectedConversationVersion: 7,
            model: DEFAULT_MODEL,
            parentId: TEST_IDS.USER_MESSAGE_ID,
            provider: DEFAULT_PROVIDER,
            sessionId: TEST_IDS.SESSION_ID,
            threadId: undefined,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.any(AbortController),
        );
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('marks a deferred browser-fallback lane when send RPC skips durable enqueue', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        (aiChatService.sendMessageInServer as Mock).mockResolvedValueOnce({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          deferReason: 'unsupported_tool',
          deferredToolName: 'lobe-image-designer',
          isCreateNewTopic: false,
          messages: [
            {
              content: TEST_CONTENT.USER_MESSAGE,
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              sessionId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.TOPIC_ID,
            },
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(
          useChatStore.getState().deferredBrowserGenerationLanes[
            messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
          ],
        ).toEqual({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          reason: 'unsupported_tool',
          toolName: 'lobe-image-designer',
        });
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('attaches a durable server operation and skips the browser runtime', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        (aiChatService.sendMessageInServer as Mock).mockResolvedValueOnce({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: false,
          messages: [
            {
              content: TEST_CONTENT.USER_MESSAGE,
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              sessionId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.TOPIC_ID,
            },
          ],
          operationId: 'cgo_durable_operation',
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          expect.objectContaining({
            generation: expect.objectContaining({
              config: expect.objectContaining({
                model: DEFAULT_MODEL,
                provider: DEFAULT_PROVIDER,
              }),
              idempotencyKey: expect.stringMatching(/^chat-send:/),
            }),
          }),
          expect.anything(),
        );
        expect(aiChatService.createAssistantMessageInServer).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
        expect(
          useChatStore.getState().serverGenerationOperations[
            messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
          ]['cgo_durable_operation'],
        ).toEqual(
          expect.objectContaining({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId: 'cgo_durable_operation',
            sessionId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          }),
        );
      });

      it('lets the server generate the topic title after a durable send', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        const summaryTopicTitle = vi.fn(async () => {});
        act(() => {
          useChatStore.setState({
            summaryTopicTitle,
            switchTopic: vi.fn(async (id: string) => {
              useChatStore.setState({ activeTopicId: id });
            }),
          });
        });
        (aiChatService.sendMessageInServer as Mock).mockResolvedValueOnce({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            {
              content: TEST_CONTENT.USER_MESSAGE,
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              sessionId: TEST_IDS.SESSION_ID,
              topicId: TEST_IDS.NEW_TOPIC_ID,
            },
          ],
          operationId: 'cgo_new_topic',
          topicId: TEST_IDS.NEW_TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(summaryTopicTitle).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('falls back to the browser runtime when no durable operation can be reconciled', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        const syncActive = vi.fn(async () => {});
        useChatStore.setState({ syncActiveConversationGenerations: syncActive });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(syncActive).toHaveBeenCalled();
        expect(aiChatService.createAssistantMessageInServer).toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('does not skip the browser runtime when only a title job is attached', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        const syncActive = vi.fn(async () => {
          useChatStore.getState().attachConversationGeneration({
            clearGeneration: 0,
            generation: 0,
            kind: 'topic_title',
            lane: 'lane-title',
            operationId: 'cgo_title',
            sessionId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
            userScope: 'current',
          });
        });
        useChatStore.setState({ syncActiveConversationGenerations: syncActive });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('omits durable enqueue when Context Export is armed', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        act(() => {
          useChatStore.setState({ contextExportCaptureStatus: 'armed' });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(
          (aiChatService.sendMessageInServer as Mock).mock.calls[0][0].generation,
        ).toBeUndefined();
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('reconciles a terminal operation that completed before attachment', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        vi.mocked(conversationGenerationService.getOperation).mockResolvedValueOnce({
          id: 'cgo_fast',
          status: 'succeeded',
        } as any);
        (aiChatService.sendMessageInServer as Mock).mockResolvedValueOnce({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: false,
          messages: [],
          operationId: 'cgo_fast',
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(
          useChatStore.getState().serverGenerationOperations[
            messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
          ],
        ).toBeUndefined();
        expect(useChatStore.getState().refreshMessages).toHaveBeenCalled();
      });

      it('recovers an ambiguously failed send by its stable idempotency key', async () => {
        vi.mocked(isClientDurableConversationGenerationEnabled).mockReturnValue(true);
        vi.spyOn(aiProviderSelectors, 'isProviderFetchOnClient').mockImplementation(
          () => () => false,
        );
        (aiChatService.sendMessageInServer as Mock).mockRejectedValueOnce(
          new Error('network disconnected'),
        );
        vi.mocked(conversationGenerationService.getOperationByIdempotencyKey).mockResolvedValueOnce(
          {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            id: 'cgo_recovered',
            kind: 'chat',
            lane: 'lane-recovered',
            laneGeneration: 1,
            sessionId: TEST_IDS.SESSION_ID,
            status: 'processing',
            topicId: TEST_IDS.TOPIC_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any,
        );
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(conversationGenerationService.getOperationByIdempotencyKey).toHaveBeenCalledWith(
          expect.stringMatching(/^chat-send:/),
        );
        expect(
          useChatStore.getState().serverGenerationOperations[
            messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
          ].cgo_recovered,
        ).toMatchObject({ lane: 'lane-recovered', operationId: 'cgo_recovered' });
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('persists deduplicated activated skill metadata on the server user message', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            activatedSkillIds: ['reviewer', 'reviewer'],
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          expect.objectContaining({
            newUserMessage: expect.objectContaining({
              metadata: { skills: { activated: ['reviewer'] } },
            }),
          }),
          expect.anything(),
        );
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
        useUserStore.setState({ isUserStateInit: true, userStateScope: currentUserScope });
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
        const operationsBeforeInvalidation = useChatStore.getState().serverGenerationOperations;

        currentUserScope = 'user:account-b';
        runtimeDeferred.resolve(undefined);
        await act(async () => {
          await sendPromise;
        });

        expect(addFilesToAgent).not.toHaveBeenCalled();
        expect(useChatStore.getState().serverGenerationOperations).toBe(
          operationsBeforeInvalidation,
        );
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
        const operationsBeforeInvalidation = useChatStore.getState().serverGenerationOperations;

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
        expect(useChatStore.getState().serverGenerationOperations).toBe(
          operationsBeforeInvalidation,
        );
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

    it('keeps the lane stop marker when send returns early on empty input', async () => {
      const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;
      const existingMarker = {
        laneGenerations: {},
        stoppedIdempotencyKeys: [],
        stoppedOperationIds: ['cgo_existing'],
      };

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          conversationLaneStopMarkers: { [laneKey]: existingMarker },
        });
      });

      await act(async () => {
        await useChatStore.getState().sendMessageInServer({ message: '' });
      });

      expect(useChatStore.getState().conversationLaneStopMarkers[laneKey]).toEqual(existingMarker);
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

    it('keeps Knowledge Base tokens active for the provider when exact tokenization fails', async () => {
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
          internal_updateMessageRAG: vi.fn(async () => undefined),
        });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        content: TEST_CONTENT.RAG_QUERY,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      vi.spyOn(result.current, 'internal_retrieveChunks').mockResolvedValue({
        chunks: [{ id: 'chunk-1', similarity: 0.88, text: 'retrieved context' }] as any,
        diagnosticId: undefined,
        queryId: 'query-1',
        retrieval: {
          candidateCount: 5,
          candidateLimit: 24,
          eligibleCount: 2,
          minimumSimilarity: 0.2,
          resultLimit: 8,
          selectedCount: 1,
          selectedScores: [0.88],
          strategy: 'cosine',
        },
        rewriteQuery: 'rewritten question',
        scope: { directFileCount: 1, expandedFileCount: 2, knowledgeBaseCount: 1 },
      });
      vi.mocked(encodeAsync).mockRejectedValueOnce(new Error('worker unavailable'));

      let capturedRequest: any;
      vi.spyOn(result.current, 'internal_fetchAIChatMessage').mockImplementation(
        async ({ params }) => {
          capturedRequest = params?.contextExportRequest;
          expect(
            useChatStore.getState().knowledgeBaseContextTokens[
              messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
            ],
          ).toBeGreaterThan(0);
          return { content: 'answer', isFunctionCall: false };
        },
      );

      let captureId: string | undefined;
      act(() => {
        result.current.armContextExport({ chatMessages: 50, total: 50 });
        captureId = result.current.consumeContextExportArm();
      });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          contextExportCaptureId: captureId,
          messages: [userMessage],
          ragQuery: TEST_CONTENT.RAG_QUERY,
          threadId: 'thread-test',
          userMessageId: userMessage.id,
        });
      });

      expect(capturedRequest).toMatchObject({
        allocation: { chatMessages: 50, knowledgeBase: expect.any(Number) },
        knowledgeBase: {
          countMode: 'estimated',
          promptTokens: expect.any(Number),
          retrieval: { selectedCount: 1 },
        },
      });
      expect(capturedRequest.knowledgeBase.promptTokens).toBeGreaterThan(0);
      expect(estimatedEncodeAsync).toHaveBeenCalled();
      expect(useChatStore.getState().knowledgeBaseContextTokens).toEqual({});
    });

    it('persists a KB preparation error instead of leaving the assistant placeholder loading', async () => {
      const diagnosticId = 'kb_1234567890abcdef';
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const reportEvent = vi
        .spyOn(ragService, 'reportKnowledgeClientEvent')
        .mockResolvedValue({ diagnosticId });
      const updateMessageRAG = vi.fn().mockRejectedValue(new Error('metadata update failed'));
      const userMessage = {
        content: TEST_CONTENT.RAG_QUERY,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
          internal_updateMessageRAG: updateMessageRAG,
          knowledgeBaseContextTokens: {},
          messageRAGLoadingIds: [],
          messagesMap: {
            [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: [
              userMessage,
              {
                content: LOADING_FLAT,
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                parentId: TEST_IDS.USER_MESSAGE_ID,
                role: 'assistant',
                sessionId: TEST_IDS.SESSION_ID,
                topicId: TEST_IDS.TOPIC_ID,
              } as UIChatMessage,
            ],
          },
        });
      });

      const { result } = renderHook(() => useChatStore());
      vi.spyOn(result.current, 'internal_retrieveChunks').mockResolvedValue({
        chunks: [{ id: 'chunk-1', similarity: 0.88, text: 'retrieved context' }] as any,
        diagnosticId,
        queryId: 'query-1',
        retrieval: {
          candidateCount: 5,
          candidateLimit: 24,
          eligibleCount: 2,
          minimumSimilarity: 0.2,
          resultLimit: 8,
          selectedCount: 1,
          selectedScores: [0.88],
          strategy: 'cosine',
        },
        rewriteQuery: TEST_CONTENT.RAG_QUERY,
        scope: { directFileCount: 1, expandedFileCount: 2, knowledgeBaseCount: 1 },
      });

      await act(async () => {
        await expect(
          result.current.internal_execAgentRuntime({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [userMessage],
            ragQuery: TEST_CONTENT.RAG_QUERY,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          }),
        ).rejects.toThrow('metadata update failed');
      });

      const assistant = Object.values(useChatStore.getState().messagesMap)
        .flat()
        .find((message) => message.id === TEST_IDS.ASSISTANT_MESSAGE_ID);
      const expectedError = {
        body: { diagnosticId },
        message:
          'Knowledge Base preparation failed. Retry the message. (Diagnostic ID: kb_1234567890abcdef)',
        type: ChatErrorType.UnknownChatFetchError,
      };

      expect(updateMessageRAG).toHaveBeenCalled();
      expect(assistant).toMatchObject({ content: LOADING_FLAT, error: expectedError });
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expectedError,
      );
      expect(reportEvent).toHaveBeenCalledWith({
        diagnosticId,
        event: 'client_preparation_failed',
        failurePhase: 'message_metadata',
      });
      expect(result.current.refreshMessages).toHaveBeenCalled();
      expect(useChatStore.getState().messageRAGLoadingIds).toEqual([]);
      expect(useChatStore.getState().knowledgeBaseContextTokens).toEqual({});
      expect(useChatStore.getState().chatLoadingIds).toEqual([]);
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

      expect(useChatStore.getState().messagesMap[messageMapKey(TEST_IDS.SESSION_ID, null)]).toEqual(
        [],
      );
    });

    it('should automatically switch to newly created topic when no active topic exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockSwitchTopic = vi.fn(async (topicId: string) => {
        useChatStore.setState({ activeTopicId: topicId });
      });
      const sourceSelectionKey = getSkillSelectionKey({ sessionId: TEST_IDS.SESSION_ID });
      const targetSelectionKey = getSkillSelectionKey({
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      });

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: undefined,
          switchTopic: mockSwitchTopic,
        });
        useSkillStore.getState().toggleSelectedSkill('reviewer', true, sourceSelectionKey);
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(mockSwitchTopic).toHaveBeenCalledWith(TEST_IDS.TOPIC_ID, true);
      expect(useSkillStore.getState().selectedSkillIdsByConversation).toEqual({
        [targetSelectionKey]: ['reviewer'],
      });
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
    it('should abort operation and restore editor state when cancelling', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const mockSetJSONState = vi.fn();
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

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

      await act(async () => {
        await result.current.cancelSendMessageInServer();
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
      expect(
        result.current.mainSendMessageOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ]?.isLoading,
      ).toBe(false);
      expect(mockSetJSONState).toHaveBeenCalledWith({ content: 'saved content' });
    });

    it('should cancel operation for specified topic ID', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const customTopicId = 'custom-topic-id';
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

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

      await act(async () => {
        await result.current.cancelSendMessageInServer(customTopicId);
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
    });

    it('bumps lane scoped clear and cancels detached durable ops', async () => {
      const cancel = vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
        {
          id: 'cgo_pre_enqueue',
          kind: 'chat',
          lane: 'lane-send',
          sessionId: TEST_IDS.SESSION_ID,
          status: 'pending',
          topicId: TEST_IDS.TOPIC_ID,
        },
      ] as any);
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.cancelSendMessageInServer();
      });

      expect(cancel).toHaveBeenCalledWith('cgo_pre_enqueue');
      const laneKey = `${messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)}:main`;
      expect(useChatStore.getState().conversationScopedClearGenerations[laneKey]).toBeGreaterThan(
        0,
      );
      expect(useChatStore.getState().conversationLaneStopMarkers[laneKey]).toMatchObject({
        stoppedOperationIds: ['cgo_pre_enqueue'],
      });
    });

    it('should handle gracefully when operation does not exist', async () => {
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

      act(() => {
        useChatStore.setState({ mainSendMessageOperations: {} });
      });

      await expect(
        act(async () => {
          await result.current.cancelSendMessageInServer('non-existing-topic');
        }),
      ).resolves.not.toThrow();
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
