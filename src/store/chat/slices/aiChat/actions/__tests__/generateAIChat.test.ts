import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { ragService } from '@/services/rag';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { aiChatSelectors, chatSelectors } from '@/store/chat/selectors';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { getSkillSelectionKey, useSkillStore } from '@/store/skill';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { UploadFileItem } from '@/types/files/upload';

import { useChatStore } from '../../../../store';
import { TEST_CONTENT, TEST_IDS, createMockMessage, createMockMessages } from './fixtures';
import {
  resetTestEnvironment,
  setupMockSelectors,
  setupStoreWithMessages,
  spyOnMessageService,
} from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: { warning: vi.fn() },
}));
vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  isClientDurableConversationGenerationEnabled: vi.fn(() => false),
}));
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
      const topicId =
        params.topicId ?? (params.newTopic ? TEST_IDS.NEW_TOPIC_ID : TEST_IDS.TOPIC_ID);
      return {
        assistantMessageId: assistantId,
        isCreateNewTopic: Boolean(params.newTopic),
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

const realCoreProcessMessage = useChatStore.getState().internal_coreProcessMessage;
const realProcessAgentMessage = useChatStore.getState().internal_processAgentMessage;

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  useUserStore.setState({ ownershipInvalidationGeneration: 0 });
  useSkillStore.setState({ selectedSkillIdsByConversation: {} });

  // Setup default spies that most tests need
  spyOnMessageService();
  vi.spyOn(conversationGenerationService, 'cancel').mockResolvedValue({} as any);
  vi.spyOn(conversationGenerationService, 'getOperationByIdempotencyKey').mockResolvedValue(
    undefined,
  );
  vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);
  // ✅ Removed spyOnChatService() - tests should spy chatService only when needed

  // Setup common mock methods that most tests need
  act(() => {
    useSessionStore.setState({ triggerSessionUpdate: vi.fn() });
    useChatStore.setState({
      internal_coreProcessMessage: vi.fn(),
      internal_execAgentRuntime: vi.fn(),
      internal_fetchMessages: vi.fn(),
      refreshMessages: vi.fn(() => Promise.resolve()),
      refreshThreads: vi.fn(),
      refreshTopic: vi.fn(() => Promise.resolve()),
    });
  });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = undefined;

  vi.restoreAllMocks();
});

describe('chatMessage actions', () => {
  describe('sendMessage', () => {
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

      afterEach(() => {
        act(() => {
          useChatStore.setState({
            triggerTokenThresholdMemoryCompaction: realTriggerCompaction,
          });
        });
      });

      it('should pass an AbortController to the token-threshold compaction trigger', async () => {
        const compactionSpy = vi.fn(() => Promise.resolve({ status: 'ineligible' }) as any);
        act(() => {
          useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactionSpy).toHaveBeenCalledWith(expect.any(AbortController));
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('should skip AI processing when the compaction is aborted by stopGenerateMessage', async () => {
        const compactionSpy = vi.fn(async () => {
          // simulate the user pressing Stop while the pre-send compaction is running
          useChatStore.getState().stopGenerateMessage();
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactionSpy).toHaveBeenCalledWith(expect.any(AbortController));
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
        expect(result.current.isCreatingMessage).toBe(false);
      });

      it('tracks a stoppable operation while compaction runs and clears it afterwards', async () => {
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
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactingDuringRun).toBe(true);
        expect(result.current.preSendCompactionOperations).toEqual({});
      });

      it("stop in another conversation does not abort this send's compaction", async () => {
        const compactionSpy = vi.fn(async () => {
          const previousTopicId = useChatStore.getState().activeTopicId;
          // a Stop pressed while another conversation is active must not abort this send
          useChatStore.setState({ activeTopicId: 'other-topic' });
          useChatStore.getState().stopGenerateMessage();
          useChatStore.setState({ activeTopicId: previousTopicId });
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactionSpy).toHaveBeenCalledWith(expect.any(AbortController));
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it("a thread-scoped stop does not abort the main conversation's compaction", async () => {
        const compactionSpy = vi.fn(async () => {
          // a Stop pressed in a thread portal (threadId set) must not cancel the main send's
          // pre-send compaction, which always runs in the main (threadId-null) context
          useChatStore.getState().stopGenerateMessage({ threadId: 'thread-x' });
          return { status: 'ineligible' } as any;
        });
        act(() => {
          useChatStore.setState({ triggerTokenThresholdMemoryCompaction: compactionSpy });
        });
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(compactionSpy).toHaveBeenCalledWith(expect.any(AbortController));
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
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
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('persists deduplicated activated skill metadata on the user message', async () => {
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

      it('should send message with files attached', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ files, message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          expect.objectContaining({
            newUserMessage: {
              content: TEST_CONTENT.USER_MESSAGE,
              files: [TEST_IDS.FILE_ID],
            },
          }),
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
          expect.objectContaining({
            newUserMessage: {
              content: TEST_CONTENT.EMPTY,
              files: [TEST_IDS.FILE_ID],
            },
          }),
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
        vi.mocked(aiChatService.sendMessageInServer).mockRejectedValueOnce(
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

      it('keeps context export armed when message creation fails', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.mocked(aiChatService.sendMessageInServer).mockRejectedValueOnce(
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
      });
    });

    describe('auto-create topic', () => {
      const TOPIC_THRESHOLD = 5;

      it('should create topic when threshold is reached and feature is enabled', async () => {
        const { result } = renderHook(() => useChatStore());

        const switchTopicMock = vi.fn(async (topicId: string) => {
          useChatStore.setState({ activeTopicId: topicId });
        });
        const sourceSelectionKey = getSkillSelectionKey({ sessionId: TEST_IDS.SESSION_ID });
        const targetSelectionKey = getSkillSelectionKey({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.NEW_TOPIC_ID,
        });

        act(() => {
          setupMockSelectors({
            agentConfig: {
              autoCreateTopicThreshold: TOPIC_THRESHOLD,
              enableAutoCreateTopic: true,
            },
          });

          useChatStore.setState({
            activeTopicId: undefined,
            messagesMap: {
              [messageMapKey(TEST_IDS.SESSION_ID)]: createMockMessages(TOPIC_THRESHOLD),
            },
            switchTopic: switchTopicMock,
          });
          useSkillStore.getState().toggleSelectedSkill('reviewer', true, sourceSelectionKey);
        });

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          expect.objectContaining({
            newTopic: expect.objectContaining({
              topicMessageIds: expect.any(Array),
            }),
          }),
          expect.anything(),
        );
        expect(switchTopicMock).toHaveBeenCalledWith(TEST_IDS.NEW_TOPIC_ID, true);
        expect(useSkillStore.getState().selectedSkillIdsByConversation).toEqual({
          [targetSelectionKey]: ['reviewer'],
        });
      });

      it('does not continue auto-topic creation after ownership invalidates', async () => {
        let resolveServerSend!: (response: any) => void;
        const serverSendPromise = new Promise<any>((resolve) => {
          resolveServerSend = resolve;
        });
        vi.mocked(aiChatService.sendMessageInServer).mockReturnValueOnce(serverSendPromise);
        const switchTopicMock = vi.fn();

        act(() => {
          setupMockSelectors({
            agentConfig: {
              autoCreateTopicThreshold: TOPIC_THRESHOLD,
              enableAutoCreateTopic: true,
            },
          });
          useChatStore.setState({
            activeTopicId: undefined,
            messagesMap: {
              [messageMapKey(TEST_IDS.SESSION_ID)]: createMockMessages(TOPIC_THRESHOLD),
            },
            switchTopic: switchTopicMock,
          });
        });

        const sendPromise = useChatStore
          .getState()
          .sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        await vi.waitFor(() => {
          expect(aiChatService.sendMessageInServer).toHaveBeenCalled();
        });

        act(() => {
          useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        });
        resolveServerSend({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [],
          topicId: TEST_IDS.NEW_TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });
        await sendPromise;

        expect(switchTopicMock).not.toHaveBeenCalled();
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
          expect.not.objectContaining({
            ragQuery: expect.anything(),
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
            expectedConversationVersion: 7,
            isWelcomeQuestion: true,
          }),
        );
      });

      it('should return early when onlyAddUserMessage is true', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            onlyAddUserMessage: true,
          });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });
    });

    describe('topic creation flow', () => {
      it('should handle tempMessage during topic creation', async () => {
        setupMockSelectors({
          chatConfig: { autoCreateTopicThreshold: 2, enableAutoCreateTopic: true },
        });

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
          setupStoreWithMessages(createMockMessages(5));
        });

        const { result } = renderHook(() => useChatStore());
        const createTopicMock = vi
          .spyOn(result.current, 'createTopic')
          .mockResolvedValue(TEST_IDS.NEW_TOPIC_ID);
        const toggleMessageLoadingSpy = vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const createTmpMessageSpy = vi
          .spyOn(result.current, 'internal_createTmpMessage')
          .mockReturnValue('temp-id');
        vi.spyOn(result.current, 'internal_fetchMessages').mockResolvedValue();
        vi.spyOn(result.current, 'switchTopic').mockImplementation(async (topicId) => {
          useChatStore.setState({ activeTopicId: topicId });
        });

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(createTmpMessageSpy).toHaveBeenCalled();
        expect(toggleMessageLoadingSpy).toHaveBeenCalledWith(true, 'temp-id');
        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          expect.objectContaining({
            newTopic: expect.objectContaining({ topicMessageIds: expect.any(Array) }),
          }),
          expect.anything(),
        );
      });

      it('should call summaryTopicTitle after processing when new topic created', async () => {
        setupMockSelectors({
          chatConfig: { autoCreateTopicThreshold: 2, enableAutoCreateTopic: true },
        });

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
          setupStoreWithMessages(createMockMessages(5));
        });

        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'createTopic').mockResolvedValue(TEST_IDS.NEW_TOPIC_ID);
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-id');
        vi.spyOn(result.current, 'internal_fetchMessages').mockResolvedValue();
        vi.spyOn(result.current, 'switchTopic').mockImplementation(async (topicId) => {
          useChatStore.setState({ activeTopicId: topicId });
        });

        const summaryTopicTitleSpy = vi
          .spyOn(result.current, 'summaryTopicTitle')
          .mockResolvedValue();

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(summaryTopicTitleSpy).toHaveBeenCalledWith(TEST_IDS.NEW_TOPIC_ID, expect.any(Array));
      });

      it('should handle topic creation failure gracefully', async () => {
        setupMockSelectors({
          chatConfig: { autoCreateTopicThreshold: 2, enableAutoCreateTopic: true },
        });

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
          setupStoreWithMessages(createMockMessages(5));
        });

        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-id');
        const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const updateTopicLoadingSpy = vi.spyOn(result.current, 'internal_updateTopicLoading');
        vi.spyOn(result.current, 'switchTopic').mockImplementation(async (topicId) => {
          useChatStore.setState({ activeTopicId: topicId });
        });

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
        expect(updateTopicLoadingSpy).not.toHaveBeenCalled();
        expect(toggleLoadingSpy).toHaveBeenCalled();
      });
    });
  });

  describe('sendGroupMessage', () => {
    it('ignores a message creation that resolves after conversation history is cleared', async () => {
      let resolveMessageCreation: (messageId: string | undefined) => void;
      const messageCreationPromise = new Promise<string | undefined>((resolve) => {
        resolveMessageCreation = resolve;
      });
      const state = useChatStore.getState();
      const internalCreateMessage = vi
        .spyOn(state, 'internal_createMessage')
        .mockImplementation(() => messageCreationPromise);
      const internalRouteGroupUserMessage = vi
        .spyOn(state, 'internal_routeGroupUserMessage')
        .mockResolvedValue(undefined);

      act(() => {
        useChatStore.setState({
          conversationClearGeneration: 0,
        });
      });

      const sendPromise = useChatStore.getState().sendGroupMessage({
        groupId: TEST_IDS.SESSION_ID,
        message: TEST_CONTENT.USER_MESSAGE,
      });

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        useChatStore.setState({ conversationClearGeneration: 1, isCreatingMessage: true });
      });

      await act(async () => {
        resolveMessageCreation!(TEST_IDS.MESSAGE_ID);
        await sendPromise;
      });

      expect(internalRouteGroupUserMessage).not.toHaveBeenCalled();
      expect(useChatStore.getState().isCreatingMessage).toBe(true);
    });

    it('keeps a capture active until the debounced supervisor finishes', async () => {
      vi.useFakeTimers();

      try {
        const state = useChatStore.getState();
        vi.spyOn(state, 'internal_createMessage').mockResolvedValue(TEST_IDS.MESSAGE_ID);
        const triggerSupervisorDecision = vi
          .spyOn(state, 'internal_triggerSupervisorDecision')
          .mockResolvedValue(undefined);

        act(() => {
          useChatStore.setState({
            groupMaps: {
              [TEST_IDS.SESSION_ID]: {
                config: { enableSupervisor: true, responseSpeed: 'fast' },
              } as any,
            },
          });
          state.armContextExport();
        });

        await act(async () => {
          await state.sendGroupMessage({
            groupId: TEST_IDS.SESSION_ID,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        const captureId = useChatStore.getState().contextExportBatch?.captureId;
        expect(captureId).toBeDefined();
        expect(useChatStore.getState().contextExportCaptureStatus).toBe('capturing');
        expect(triggerSupervisorDecision).not.toHaveBeenCalled();

        await act(async () => {
          await vi.runAllTimersAsync();
        });

        expect(triggerSupervisorDecision).toHaveBeenCalledWith(
          TEST_IDS.SESSION_ID,
          TEST_IDS.TOPIC_ID,
          false,
          7,
          captureId,
        );
        expect(useChatStore.getState().contextExportCaptureStatus).toBe('ready');
        expect(useChatStore.getState().contextExportBatch?.status).toBe('partial');
      } finally {
        vi.useRealTimers();
      }
    });

    it('transfers a pending capture when a second group message replaces the debounce timer', async () => {
      vi.useFakeTimers();

      try {
        const state = useChatStore.getState();
        vi.spyOn(state, 'internal_createMessage').mockResolvedValue(TEST_IDS.MESSAGE_ID);
        const triggerSupervisorDecision = vi
          .spyOn(state, 'internal_triggerSupervisorDecision')
          .mockResolvedValue(undefined);

        act(() => {
          useChatStore.setState({
            groupMaps: {
              [TEST_IDS.SESSION_ID]: {
                config: { enableSupervisor: true, responseSpeed: 'fast' },
              } as any,
            },
          });
          state.armContextExport();
        });

        await act(async () => {
          await state.sendGroupMessage({
            groupId: TEST_IDS.SESSION_ID,
            message: 'first captured message',
          });
        });

        const captureId = useChatStore.getState().contextExportBatch?.captureId;
        expect(captureId).toBeDefined();

        await act(async () => {
          await state.sendGroupMessage({
            groupId: TEST_IDS.SESSION_ID,
            message: 'second debounced message',
          });
        });

        expect(useChatStore.getState().contextExportCaptureStatus).toBe('capturing');
        expect(useChatStore.getState().contextExportBatch?.captureId).toBe(captureId);
        expect(triggerSupervisorDecision).not.toHaveBeenCalled();

        await act(async () => {
          await vi.runAllTimersAsync();
        });

        expect(triggerSupervisorDecision).toHaveBeenCalledTimes(1);
        expect(triggerSupervisorDecision).toHaveBeenCalledWith(
          TEST_IDS.SESSION_ID,
          TEST_IDS.TOPIC_ID,
          false,
          7,
          captureId,
        );
        expect(useChatStore.getState().contextExportCaptureStatus).toBe('ready');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('internal_processAgentMessage', () => {
    it('keeps the capture ID through group tool execution and continuation', async () => {
      const groupId = TEST_IDS.SESSION_ID;
      const agentId = 'group-agent';
      const contextExportCaptureId = 'context_group_tool';
      const userMessage = createMockMessage({
        content: TEST_CONTENT.USER_MESSAGE,
        groupId,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });
      const chatKey = messageMapKey(groupId, TEST_IDS.TOPIC_ID);
      const state = useChatStore.getState();

      vi.spyOn(sessionSelectors, 'currentGroupAgents').mockReturnValue([
        {
          id: agentId,
          model: 'gpt-4o-mini',
          provider: 'openai',
          systemRole: 'Group member role',
          title: 'Group Agent',
        } as any,
      ]);
      vi.spyOn(userProfileSelectors, 'nickName').mockReturnValue('Test User');
      vi.spyOn(userGeneralSettingsSelectors, 'generalInstruction').mockReturnValue('');
      vi.spyOn(state, 'internal_createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);
      vi.spyOn(state, 'internal_fetchAIChatMessage').mockResolvedValue({
        content: '',
        isFunctionCall: true,
        persistenceAmbiguous: false,
      });
      vi.spyOn(state, 'refreshMessages').mockResolvedValue(undefined);
      const triggerToolCalls = vi.spyOn(state, 'triggerToolCalls').mockResolvedValue(undefined);
      const processAgentMessage = vi
        .fn()
        .mockImplementationOnce(realProcessAgentMessage)
        .mockResolvedValue(undefined);

      act(() => {
        useChatStore.setState({
          internal_processAgentMessage: processAgentMessage,
          messagesMap: { [chatKey]: [userMessage] },
        });
      });

      await act(async () => {
        await useChatStore
          .getState()
          .internal_processAgentMessage(
            groupId,
            agentId,
            undefined,
            undefined,
            7,
            contextExportCaptureId,
          );
      });

      expect(triggerToolCalls).toHaveBeenCalledWith(TEST_IDS.ASSISTANT_MESSAGE_ID, {
        contextExportCaptureId,
        expectedConversationVersion: 7,
        inPortalThread: false,
        threadId: undefined,
      });
      expect(processAgentMessage).toHaveBeenNthCalledWith(
        2,
        groupId,
        agentId,
        undefined,
        undefined,
        7,
        contextExportCaptureId,
        true,
      );
    });

    it('does not execute group tools after ownership invalidates during refresh', async () => {
      const groupId = TEST_IDS.SESSION_ID;
      const agentId = 'group-agent';
      const userMessage = createMockMessage({
        content: TEST_CONTENT.USER_MESSAGE,
        groupId,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });
      const chatKey = messageMapKey(groupId, TEST_IDS.TOPIC_ID);
      const state = useChatStore.getState();
      let resolveRefresh!: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      vi.spyOn(sessionSelectors, 'currentGroupAgents').mockReturnValue([
        {
          id: agentId,
          model: 'gpt-4o-mini',
          provider: 'openai',
          systemRole: 'Group member role',
          title: 'Group Agent',
        } as any,
      ]);
      vi.spyOn(userProfileSelectors, 'nickName').mockReturnValue('Test User');
      vi.spyOn(userGeneralSettingsSelectors, 'generalInstruction').mockReturnValue('');
      vi.spyOn(state, 'internal_createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);
      vi.spyOn(state, 'internal_fetchAIChatMessage').mockResolvedValue({
        content: '',
        isFunctionCall: true,
        persistenceAmbiguous: false,
      });
      vi.spyOn(state, 'refreshMessages').mockReturnValue(refreshPromise);
      const triggerToolCalls = vi.spyOn(state, 'triggerToolCalls').mockResolvedValue(undefined);

      act(() => {
        useChatStore.setState({
          internal_processAgentMessage: realProcessAgentMessage,
          messagesMap: { [chatKey]: [userMessage] },
        });
      });

      const processPromise = useChatStore
        .getState()
        .internal_processAgentMessage(groupId, agentId, undefined, undefined, 7);
      await vi.waitFor(() => {
        expect(state.refreshMessages).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      });
      resolveRefresh();
      await processPromise;

      expect(triggerToolCalls).not.toHaveBeenCalled();
    });
  });

  describe('regenerateMessage', () => {
    it('should trigger message regeneration', async () => {
      const { result } = renderHook(() => useChatStore());
      const traceId = 'test-trace-id';

      act(() => {
        setupStoreWithMessages([
          createMockMessage({
            id: TEST_IDS.MESSAGE_ID,
            tools: [{ id: 'tool1' }, { id: 'tool2' }] as any,
            traceId,
          }),
        ]);
      });

      const resendMessageSpy = vi.spyOn(result.current, 'internal_resendMessage');

      await act(async () => {
        await result.current.regenerateMessage(TEST_IDS.MESSAGE_ID);
      });

      expect(resendMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.MESSAGE_ID,
        expect.objectContaining({}),
      );
    });
  });

  describe('delAndRegenerateMessage', () => {
    it('should use the same transactional resend path', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        setupStoreWithMessages([
          createMockMessage({
            id: TEST_IDS.MESSAGE_ID,
            tools: [{ id: 'tool1' }] as any,
          }),
        ]);
      });

      const resendMessageSpy = vi.spyOn(result.current, 'internal_resendMessage');

      await act(async () => {
        await result.current.delAndRegenerateMessage(TEST_IDS.MESSAGE_ID);
      });

      expect(resendMessageSpy).toHaveBeenCalled();
    });
  });

  describe('stopGenerateMessage', () => {
    it('should abort generation and clear loading state when controller exists', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const abortController = new AbortController();

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingAbortControllersByLane: { [mainLaneKey]: abortController },
          chatLoadingIds: ['msg-1'],
          chatLoadingIdsAbortController: abortController,
          chatLoadingLaneByMessageId: { 'msg-1': mainLaneKey },
        });
      });

      const { result } = renderHook(() => useChatStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleChatLoading');

      await act(async () => {
        await result.current.stopGenerateMessage();
      });

      expect(abortController.signal.aborted).toBe(true);
      expect(toggleLoadingSpy).toHaveBeenCalledWith(false, 'msg-1', expect.any(String), null);
    });

    it('awaits durable cancel even when no abort controller is set', async () => {
      const stopDurable = vi.fn(async () => {});
      act(() => {
        useChatStore.setState({
          chatLoadingIdsAbortController: undefined,
          stopDurableConversationGeneration: stopDurable,
        });
      });

      const { result } = renderHook(() => useChatStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleChatLoading');

      await act(async () => {
        await result.current.stopGenerateMessage();
      });

      expect(stopDurable).toHaveBeenCalled();
      expect(toggleLoadingSpy).not.toHaveBeenCalled();
    });

    it('thread stop bumps only the thread lane scoped clear generation', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const threadLaneKey = `${messageMapKey(sessionId, topicId)}:thread-1`;

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingIdsAbortController: new AbortController(),
          conversationScopedClearGenerations: {},
          stopDurableConversationGeneration: vi.fn(),
        });
      });

      await act(async () => {
        await useChatStore.getState().stopGenerateMessage({ threadId: 'thread-1' });
      });

      expect(
        useChatStore.getState().conversationScopedClearGenerations[threadLaneKey],
      ).toBeGreaterThan(0);
      expect(useChatStore.getState().conversationScopedClearGenerations[mainLaneKey] ?? 0).toBe(0);
    });

    it('portal thread stop leaves the main lane controller and loading id intact', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const threadLaneKey = `${messageMapKey(sessionId, topicId)}:thread-1`;
      const mainController = new AbortController();
      const threadController = new AbortController();

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingAbortControllersByLane: {
            [mainLaneKey]: mainController,
            [threadLaneKey]: threadController,
          },
          chatLoadingIds: ['main-msg', 'thread-msg'],
          chatLoadingIdsAbortController: threadController,
          chatLoadingLaneByMessageId: {
            'main-msg': mainLaneKey,
            'thread-msg': threadLaneKey,
          },
          stopDurableConversationGeneration: vi.fn(),
        });
      });

      await act(async () => {
        await useChatStore.getState().stopGenerateMessage({ threadId: 'thread-1' });
      });

      expect(threadController.signal.aborted).toBe(true);
      expect(mainController.signal.aborted).toBe(false);
      expect(useChatStore.getState().chatLoadingIds).toEqual(['main-msg']);
    });

    it('main stop leaves the portal thread lane intact when global controller points at thread', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const threadLaneKey = `${messageMapKey(sessionId, topicId)}:thread-1`;
      const mainController = new AbortController();
      const threadController = new AbortController();

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingAbortControllersByLane: {
            [mainLaneKey]: mainController,
            [threadLaneKey]: threadController,
          },
          chatLoadingIds: ['main-msg', 'thread-msg'],
          chatLoadingIdsAbortController: threadController,
          chatLoadingLaneByMessageId: {
            'main-msg': mainLaneKey,
            'thread-msg': threadLaneKey,
          },
          stopDurableConversationGeneration: vi.fn(),
        });
      });

      await act(async () => {
        await useChatStore.getState().stopGenerateMessage();
      });

      expect(mainController.signal.aborted).toBe(true);
      expect(threadController.signal.aborted).toBe(false);
      expect(useChatStore.getState().chatLoadingIds).toEqual(['thread-msg']);
    });

    it('main stop bumps only the main lane scoped clear generation', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const threadLaneKey = `${messageMapKey(sessionId, topicId)}:thread-1`;

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingIdsAbortController: new AbortController(),
          conversationScopedClearGenerations: {
            [threadLaneKey]: 2,
          },
          stopDurableConversationGeneration: vi.fn(),
        });
      });

      await act(async () => {
        await useChatStore.getState().stopGenerateMessage();
      });

      expect(
        useChatStore.getState().conversationScopedClearGenerations[mainLaneKey],
      ).toBeGreaterThan(0);
      expect(useChatStore.getState().conversationScopedClearGenerations[threadLaneKey]).toBe(2);
    });
  });

  describe('retryMessage lane loading', () => {
    it('main retry aborts only the main lane controller', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const threadLaneKey = `${messageMapKey(sessionId, topicId)}:thread-1`;
      const mainController = new AbortController();
      const threadController = new AbortController();
      const user = createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' });
      const assistant = createMockMessage({
        id: TEST_IDS.ASSISTANT_MESSAGE_ID,
        parentId: user.id,
        role: 'assistant',
      });

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingAbortControllersByLane: {
            [mainLaneKey]: mainController,
            [threadLaneKey]: threadController,
          },
          chatLoadingIds: ['main-msg', 'thread-msg'],
          chatLoadingIdsAbortController: threadController,
          chatLoadingLaneByMessageId: {
            'main-msg': mainLaneKey,
            'thread-msg': threadLaneKey,
          },
          cancelAndDetachDurableOps: vi.fn(async () => {}),
          messagesMap: {
            [messageMapKey(sessionId, topicId)]: [user, assistant],
          },
        });
      });

      const { result } = renderHook(() => useChatStore());
      vi.spyOn(messageService, 'rewindMessages').mockResolvedValue({
        messageIds: [TEST_IDS.ASSISTANT_MESSAGE_ID],
        threadIds: [],
      });

      await act(async () => {
        await result.current.internal_resendMessage(assistant.id);
      });

      expect(mainController.signal.aborted).toBe(true);
      expect(threadController.signal.aborted).toBe(false);
      expect(useChatStore.getState().chatLoadingIds).toEqual(['thread-msg']);
    });

    it('main retry preserves sibling-lane auxiliary loading and plugin controllers', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const user = createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' });
      const anchor = createMockMessage({
        id: TEST_IDS.ASSISTANT_MESSAGE_ID,
        parentId: user.id,
        role: 'assistant',
      });
      const mainTool = createMockMessage({
        id: 'main-tool-msg',
        parentId: anchor.id,
        role: 'assistant',
      });
      const mainPluginController = new AbortController();
      const threadPluginController = new AbortController();
      const toolsController = new AbortController();
      const reasoningController = new AbortController();
      const searchController = new AbortController();

      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          cancelAndDetachDurableOps: vi.fn(async () => {}),
          messageInToolsCallingIds: ['main-tool-msg', 'thread-tool-msg'],
          messageInToolsCallingIdsAbortController: toolsController,
          messagesMap: {
            [messageMapKey(sessionId, topicId)]: [user, anchor, mainTool],
          },
          pluginApiAbortControllers: {
            'main-tool-msg': mainPluginController,
            'thread-plugin-msg': threadPluginController,
          },
          pluginApiLoadingIds: ['main-tool-msg', 'thread-plugin-msg'],
          reasoningLoadingIds: ['main-tool-msg', 'thread-reasoning-msg'],
          reasoningLoadingIdsAbortController: reasoningController,
          searchWorkflowLoadingIds: ['main-tool-msg'],
          searchWorkflowLoadingIdsAbortController: searchController,
        });
      });

      const { result } = renderHook(() => useChatStore());
      vi.spyOn(messageService, 'rewindMessages').mockResolvedValue({
        messageIds: [anchor.id, 'main-tool-msg'],
        threadIds: [],
      });

      await act(async () => {
        await result.current.internal_resendMessage(anchor.id);
      });

      const state = useChatStore.getState();
      // Discarded main-lane plugin work is aborted; the sibling lane's is not.
      expect(mainPluginController.signal.aborted).toBe(true);
      expect(threadPluginController.signal.aborted).toBe(false);
      expect(state.pluginApiLoadingIds).toEqual(['thread-plugin-msg']);
      expect(Object.keys(state.pluginApiAbortControllers)).toEqual(['thread-plugin-msg']);
      // Shared bookkeeping controllers survive while sibling-lane ids remain.
      expect(toolsController.signal.aborted).toBe(false);
      expect(reasoningController.signal.aborted).toBe(false);
      expect(state.messageInToolsCallingIds).toEqual(['thread-tool-msg']);
      expect(state.messageInToolsCallingIdsAbortController).toBe(toolsController);
      expect(state.reasoningLoadingIds).toEqual(['thread-reasoning-msg']);
      expect(state.reasoningLoadingIdsAbortController).toBe(reasoningController);
      // A fully discarded list releases its shared controller.
      expect(searchController.signal.aborted).toBe(true);
      expect(state.searchWorkflowLoadingIds).toEqual([]);
      expect(state.searchWorkflowLoadingIdsAbortController).toBeUndefined();
    });
  });

  describe('internal_coreProcessMessage', () => {
    it('stops before creating an assistant when the conversation changes', async () => {
      let resolveConversationVersion: (version: number) => void;
      const conversationVersionPromise = new Promise<number>((resolve) => {
        resolveConversationVersion = resolve;
      });
      vi.spyOn(messageService, 'getConversationVersion').mockReturnValue(
        conversationVersionPromise,
      );
      const createMessageSpy = vi.spyOn(messageService, 'createMessage');
      const userMessage = createMockMessage({
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });

      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const processPromise = useChatStore
        .getState()
        .internal_coreProcessMessage([userMessage], userMessage.id);
      await Promise.resolve();

      act(() => {
        useChatStore.getState().internal_updateActiveId('other-session');
      });

      resolveConversationVersion!(7);
      await processPromise;

      expect(createMessageSpy).not.toHaveBeenCalled();
    });

    it('should process user message and generate AI response', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        content: TEST_CONTENT.USER_MESSAGE,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });

      // ✅ Spy the direct dependency instead of chatService
      const fetchAIChatSpy = vi
        .spyOn(result.current, 'internal_fetchAIChatMessage')
        .mockResolvedValue({ content: 'AI response', isFunctionCall: false });

      const createMessageSpy = vi
        .spyOn(messageService, 'createMessage')
        .mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id);
      });

      expect(createMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: LOADING_FLAT,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
        { expectedConversationVersion: 7 },
      );

      expect(fetchAIChatSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('accounts for the active RAG prompt and includes its summary in context export', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        content: TEST_CONTENT.RAG_QUERY,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });

      const retrieveChunksSpy = vi
        .spyOn(result.current, 'internal_retrieveChunks')
        .mockResolvedValue({
          chunks: [{ id: 'chunk-1', similarity: 0.9, text: 'chunk text' }] as any,
          diagnosticId: undefined,
          queryId: 'query-1',
          retrieval: {
            candidateCount: 4,
            candidateLimit: 24,
            eligibleCount: 2,
            minimumSimilarity: 0.2,
            resultLimit: 8,
            selectedCount: 1,
            selectedScores: [0.9],
            strategy: 'cosine',
          },
          rewriteQuery: 'rewritten query',
          scope: { directFileCount: 1, expandedFileCount: 3, knowledgeBaseCount: 1 },
        });

      vi.spyOn(messageService, 'createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);
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
        result.current.armContextExport({ chatMessages: 75, total: 75 });
        captureId = result.current.consumeContextExportArm();
      });

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id, {
          contextExportCaptureId: captureId,
          ragQuery: TEST_CONTENT.RAG_QUERY,
          threadId: 'thread-test',
        });
      });

      expect(retrieveChunksSpy).toHaveBeenCalledWith(
        TEST_IDS.USER_MESSAGE_ID,
        TEST_CONTENT.RAG_QUERY,
        [],
      );
      expect(capturedRequest).toMatchObject({
        allocation: {
          chatMessages: 75,
          knowledgeBase: expect.any(Number),
          total: expect.any(Number),
        },
        continuationReason: 'initial',
        knowledgeBase: {
          promptTokens: expect.any(Number),
          queryRewritten: true,
          retrieval: { candidateCount: 4, selectedCount: 1 },
          scope: { directFileCount: 1, expandedFileCount: 3, knowledgeBaseCount: 1 },
        },
      });
      expect(capturedRequest.knowledgeBase.promptTokens).toBeGreaterThan(0);
      expect(capturedRequest.allocation.total).toBe(
        75 + capturedRequest.knowledgeBase.promptTokens,
      );
      expect(useChatStore.getState().knowledgeBaseContextTokens).toEqual({});
      const continuation = result.current.createContextExportRequest(
        captureId!,
        'assistant',
        'tool',
      );
      expect(continuation).toMatchObject({
        allocation: { chatMessages: 75, total: 75 },
        continuationReason: 'tool',
      });
      expect(continuation).not.toHaveProperty('knowledgeBase');
    });

    it('captures a diagnostic partial export when RAG preparation fails before dispatch', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });
      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        content: TEST_CONTENT.RAG_QUERY,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });
      vi.spyOn(result.current, 'internal_retrieveChunks').mockRejectedValue(
        new Error('rewrite failed'),
      );
      vi.spyOn(ragService, 'reportKnowledgeClientEvent').mockResolvedValue({
        diagnosticId: 'kb_1234567890abcdef',
      });

      let captureId: string | undefined;
      act(() => {
        result.current.armContextExport({ chatMessages: 20, total: 20 });
        captureId = result.current.consumeContextExportArm();
      });

      await expect(
        result.current.internal_coreProcessMessage([userMessage], userMessage.id, {
          contextExportCaptureId: captureId,
          ragQuery: TEST_CONTENT.RAG_QUERY,
        }),
      ).rejects.toThrow('kb_1234567890abcdef');

      expect(result.current.contextExportBatch?.requests[0]).toMatchObject({
        error: 'Knowledge Base preparation failed (Diagnostic ID: kb_1234567890abcdef)',
        status: 'error',
      });
      expect(messageService.createMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant' }),
        expect.anything(),
      );
    });

    it('should not process when createMessage fails', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });

      // ✅ Spy the direct dependency instead of chatService
      const fetchAIChatSpy = vi
        .spyOn(result.current, 'internal_fetchAIChatMessage')
        .mockResolvedValue({ content: '', isFunctionCall: false });

      vi.spyOn(messageService, 'createMessage').mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id);
      });

      expect(fetchAIChatSpy).not.toHaveBeenCalled();
    });

    it('should not summarize history again for an automatic tool continuation', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const messages = [
        createMockMessage({ id: 'old-user', role: 'user' }),
        createMockMessage({ id: 'old-assistant', role: 'assistant' }),
        createMockMessage({ id: 'tool-result', role: 'tool' }),
      ];
      const triggerMessageCountMemoryCompaction = vi.fn();
      vi.spyOn(agentChatConfigSelectors, 'enableHistoryCount').mockReturnValue(true);
      vi.spyOn(agentChatConfigSelectors, 'historyCount').mockReturnValue(2);
      vi.spyOn(result.current, 'internal_fetchAIChatMessage').mockResolvedValue({
        content: 'AI response',
        isFunctionCall: false,
      });
      vi.spyOn(messageService, 'createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);
      useChatStore.setState({ triggerMessageCountMemoryCompaction });

      await act(async () => {
        await useChatStore.getState().internal_coreProcessMessage(messages, 'tool-result', {
          isToolContinuation: true,
        });
      });

      expect(triggerMessageCountMemoryCompaction).not.toHaveBeenCalled();
    });

    it('does not execute tool calls when assistant persistence remains ambiguous', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });
      const userMessage = createMockMessage({
        content: TEST_CONTENT.USER_MESSAGE,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });
      const fetchAIChatMessage = vi.fn().mockResolvedValue({
        content: '',
        isFunctionCall: true,
        persistenceAmbiguous: true,
      });
      const state = useChatStore.getState();
      const fetchAIChatMessageSpy = vi
        .spyOn(state, 'internal_fetchAIChatMessage')
        .mockImplementation(fetchAIChatMessage);
      const refreshMessages = vi.spyOn(state, 'refreshMessages').mockResolvedValue(undefined);
      const triggerToolCalls = vi.spyOn(state, 'triggerToolCalls').mockResolvedValue(undefined);
      const toggleMessageInToolsCalling = vi.spyOn(state, 'internal_toggleMessageInToolsCalling');
      vi.spyOn(messageService, 'createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);

      await act(async () => {
        await useChatStore
          .getState()
          .internal_coreProcessMessage([userMessage], TEST_IDS.USER_MESSAGE_ID);
      });

      expect(fetchAIChatMessageSpy).toHaveBeenCalledTimes(1);
      expect(refreshMessages).toHaveBeenCalledTimes(1);
      expect(toggleMessageInToolsCalling).not.toHaveBeenCalledWith(
        true,
        TEST_IDS.ASSISTANT_MESSAGE_ID,
      );
      expect(triggerToolCalls).not.toHaveBeenCalled();
      const { notification } = await import('@/components/AntdStaticMethods');
      expect(notification.warning).toHaveBeenCalledTimes(1);
      const warningPayload = vi.mocked(notification.warning).mock.calls[0][0];
      expect(warningPayload).toHaveProperty('description');
      expect(warningPayload).toHaveProperty('message');
    });

    it('continues completed tool calls when post-finalization revalidation fails', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });
      const userMessage = createMockMessage({
        content: TEST_CONTENT.USER_MESSAGE,
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
      });
      const state = useChatStore.getState();
      vi.spyOn(state, 'internal_fetchAIChatMessage').mockResolvedValue({
        content: '',
        isFunctionCall: true,
        persistenceAmbiguous: false,
      });
      const refreshMessages = vi
        .spyOn(state, 'refreshMessages')
        .mockRejectedValue(new Error('revalidation failed'));
      const triggerToolCalls = vi.spyOn(state, 'triggerToolCalls').mockResolvedValue(undefined);
      vi.spyOn(messageService, 'createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);

      await act(async () => {
        await useChatStore
          .getState()
          .internal_coreProcessMessage([userMessage], TEST_IDS.USER_MESSAGE_ID);
      });

      expect(refreshMessages).toHaveBeenCalledTimes(2);
      expect(triggerToolCalls).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(Object),
      );
    });
  });

  describe('internal_fetchAIChatMessage', () => {
    const setupCompactedTopic = () => {
      const messages = [
        createMockMessage({ id: 'compacted-message', role: 'user' }),
        createMockMessage({ id: 'recent-message', role: 'user' }),
      ];
      useChatStore.setState({
        topicMaps: {
          [TEST_IDS.SESSION_ID]: [
            {
              historySummary: 'Rolling topic summary',
              id: TEST_IDS.TOPIC_ID,
              metadata: { historySummaryLastMessageId: 'compacted-message' },
            } as any,
          ],
        },
      });
      vi.mocked(agentChatConfigSelectors.currentChatConfig).mockReturnValue({
        enableCompressHistory: true,
        enableUserMemoryArchive: false,
      } as any);
      vi.spyOn(agentChatConfigSelectors, 'enableHistoryCount').mockReturnValue(true);
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockResolvedValue(undefined as any);

      return { messages, streamSpy };
    };

    it('uses the rolling summary and post-cursor messages for a regular topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const { messages, streamSpy } = setupCompactedTopic();

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(streamSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          historySummary: 'Rolling topic summary',
          params: expect.objectContaining({ messages: [messages[1]] }),
        }),
      );
    });

    it.each([
      ['thread', { threadId: 'thread-id' }, undefined],
      ['group', { agentId: 'agent-id', groupId: 'group-id' }, 'group'],
    ])('does not apply the topic summary or cursor to a %s request', async (_, params, type) => {
      const { result } = renderHook(() => useChatStore());
      const { messages, streamSpy } = setupCompactedTopic();
      useChatStore.setState({ activeSessionType: type as any });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          params,
          provider: 'openai',
        });
      });

      expect(streamSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          historySummary: undefined,
          params: expect.objectContaining({ messages }),
        }),
      );
    });

    it('should fetch and return AI chat response', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // ✅ Mock chatService instead of global fetch
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          // Simulate text chunks streaming
          await onMessageHandle?.({ text: TEST_CONTENT.AI_RESPONSE, type: 'text' } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(false);
        expect(response.content).toEqual(TEST_CONTENT.AI_RESPONSE);
      });

      streamSpy.mockRestore();
    });

    it('persists the complete assistant finalization in one message update', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const grounding = {
        citations: [{ title: 'Example', url: 'https://example.com' }],
        searchQueries: ['test query'],
      };
      const reasoning = { content: 'Reasoning' };
      const toolCalls = [
        { function: { arguments: '{}', name: 'test' }, id: 'tool-1', type: 'function' },
      ];

      useChatStore.setState({
        internal_transformToolCalls: vi.fn().mockReturnValue(toolCalls),
      });
      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish, onMessageHandle }) => {
          await onMessageHandle?.({
            isAnimationActives: [true],
            tool_calls: toolCalls,
            type: 'tool_calls',
          } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            grounding,
            observationId: 'observation-id',
            reasoning,
            toolCalls,
            traceId: 'trace-id',
            usage: { inputTextTokens: 10, outputTextTokens: 5, totalTokens: 15 },
          } as any);
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.updateMessage).toHaveBeenCalledTimes(1);
      expect(messageService.updateMessage).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        {
          content: TEST_CONTENT.AI_RESPONSE,
          metadata: { inputTextTokens: 10, outputTextTokens: 5, totalTokens: 15 },
          model: 'gpt-4o-mini',
          observationId: 'observation-id',
          provider: 'openai',
          reasoning: { ...reasoning, duration: undefined },
          search: grounding,
          tools: toolCalls,
          traceId: 'trace-id',
        },
        {
          diagnosticId: expect.stringMatching(/^td_[\w-]{20}$/),
          diagnosticOperation: 'finalize_assistant_message',
          showNotification: false,
        },
      );
    });

    it('persists the finalization even when the user navigated to another topic mid-stream', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          // the user switches to another topic while the reply is streaming
          useChatStore.setState({ activeTopicId: 'other-topic' });
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ content: TEST_CONTENT.AI_RESPONSE }),
        expect.anything(),
      );
    });

    it('does not abort a deferred lane on invalidate and still persists onFinish', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const conversationKey = deferredBrowserGenerationLaneKey(
        TEST_IDS.SESSION_ID,
        TEST_IDS.TOPIC_ID,
        null,
      );
      let releaseStream: (() => Promise<void>) | undefined;

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          await new Promise<void>((resolve) => {
            releaseStream = async () => {
              await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
              resolve();
            };
          });
        },
      );

      const fetchPromise = result.current.internal_fetchAIChatMessage({
        messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        messages,
        model: 'gpt-4o-mini',
        provider: 'openai',
      });

      await waitFor(() => {
        expect(useChatStore.getState().chatLoadingIds).toContain(TEST_IDS.ASSISTANT_MESSAGE_ID);
      });

      const laneKey = useChatStore.getState().chatLoadingLaneByMessageId[TEST_IDS.ASSISTANT_MESSAGE_ID];
      const controller = laneKey
        ? useChatStore.getState().chatLoadingAbortControllersByLane[laneKey]
        : undefined;
      const abortSpy = controller ? vi.spyOn(controller, 'abort') : vi.fn();

      act(() => {
        useChatStore.getState().internal_markDurableLaneDeferred({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          reason: 'unsupported_tool',
          sessionId: TEST_IDS.SESSION_ID,
          toolName: 'lobe-code-interpreter',
          topicId: TEST_IDS.TOPIC_ID,
        });
        useChatStore.getState().internal_invalidateConversation();
      });

      expect(abortSpy).not.toHaveBeenCalled();
      expect(useChatStore.getState().deferredBrowserGenerationLanes[conversationKey]).toBeDefined();

      await act(async () => {
        await releaseStream?.();
        await fetchPromise;
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ content: TEST_CONTENT.AI_RESPONSE }),
        expect.anything(),
      );
    });

    it('persists a function-call skeleton off-screen so switch-back can resume tools', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const toolCalls = [
        { function: { arguments: '{}', name: 'lobe-code-interpreter' }, id: 'call-1', type: 'function' },
      ];

      useChatStore.setState({
        internal_transformToolCalls: vi.fn().mockReturnValue(toolCalls),
      });
      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          useChatStore.setState({ activeTopicId: 'other-topic' });
          await onFinish?.('', { toolCalls } as any);
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ tools: expect.any(Array) }),
        expect.anything(),
      );
    });

    it('does not persist the finalization after the account switched mid-stream', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish }) => {
          useUserStore.setState({ ownershipInvalidationGeneration: 1 });
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.updateMessage).not.toHaveBeenCalled();
    });

    it('persists partial content when an interrupted turn already streamed text', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onAbort }) => {
          await onAbort?.('partial answer');
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ content: 'partial answer' }),
      );
      expect(messageService.removeMessage).not.toHaveBeenCalled();
    });

    it('removes the placeholder when an interrupted turn streamed nothing', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onAbort }) => {
          await onAbort?.('');
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.removeMessage).toHaveBeenCalledWith(TEST_IDS.ASSISTANT_MESSAGE_ID);
      expect(messageService.updateMessage).not.toHaveBeenCalled();
    });

    it('deletes an empty deferred-lane placeholder after Stop', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const conversationKey = deferredBrowserGenerationLaneKey(
        TEST_IDS.SESSION_ID,
        TEST_IDS.TOPIC_ID,
        null,
      );

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          deferredBrowserGenerationLanes: {
            [conversationKey]: {
              assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
              reason: 'unsupported_tool',
              toolName: 'lobe-code-interpreter',
            },
          },
        });
      });

      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onAbort }) => {
          await onAbort?.('');
        },
      );

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(messageService.removeMessage).toHaveBeenCalledWith(TEST_IDS.ASSISTANT_MESSAGE_ID);
      expect(messageService.updateMessage).not.toHaveBeenCalled();
    });

    it('clears all stream loading indicators when finalization throws', async () => {
      const messages = [createMockMessage({ role: 'user' })];
      const toggleChatLoading = vi.fn().mockReturnValue(new AbortController());
      const toggleChatReasoning = vi.fn();
      const toggleToolCallingStreaming = vi.fn();
      const state = useChatStore.getState();
      vi.spyOn(state, 'internal_toggleChatLoading').mockImplementation(toggleChatLoading);
      vi.spyOn(state, 'internal_toggleChatReasoning').mockImplementation(toggleChatReasoning);
      vi.spyOn(state, 'internal_toggleToolCallingStreaming').mockImplementation(
        toggleToolCallingStreaming,
      );
      vi.spyOn(state, 'internal_updateMessageContent').mockRejectedValue(
        new Error('database rejected'),
      );
      vi.spyOn(chatService, 'createAssistantMessageStream').mockImplementation(
        async ({ onFinish, onMessageHandle }) => {
          await onMessageHandle?.({
            isAnimationActives: [true],
            tool_calls: [
              { function: { arguments: '{}', name: 'test' }, id: 'tool-1', type: 'function' },
            ],
            type: 'tool_calls',
          } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        },
      );

      await expect(
        useChatStore.getState().internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        }),
      ).rejects.toThrow('database rejected');

      expect(toggleChatLoading).toHaveBeenLastCalledWith(
        false,
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(String),
        null,
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );
      expect(toggleChatReasoning).toHaveBeenLastCalledWith(
        false,
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(String),
      );
      expect(toggleToolCallingStreaming).toHaveBeenLastCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        undefined,
      );
    });

    it('should handle streaming errors gracefully', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      let contextExportCaptureId: string | undefined;

      act(() => {
        result.current.armContextExport();
        contextExportCaptureId = result.current.consumeContextExportArm();
      });

      // ✅ Mock chatService to simulate error
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onErrorHandle }) => {
          await onErrorHandle?.({ message: 'Network error', type: 'InvalidProviderAPIKey' } as any);
        });

      const updateMessageErrorSpy = vi.spyOn(messageService, 'updateMessageError');

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          params: { contextExportCaptureId },
          provider: 'openai',
        });
      });

      expect(updateMessageErrorSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ type: 'InvalidProviderAPIKey' }),
      );
      expect(result.current.contextExportBatch?.requests[0]).toMatchObject({
        error: 'Provider request failed: InvalidProviderAPIKey',
        status: 'error',
      });

      streamSpy.mockRestore();
    });

    it('should handle tool call chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            isAnimationActives: [true],
            tool_calls: [
              { function: { arguments: '{}', name: 'test' }, id: 'tool-1', type: 'function' },
            ],
            type: 'tool_calls',
          } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { function: { arguments: '{}', name: 'test' }, id: 'tool-1', type: 'function' },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(true);
      });

      streamSpy.mockRestore();
    });

    it('should handle text chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ text: 'Hello', type: 'text' } as any);
          await onMessageHandle?.({ text: ' World', type: 'text' } as any);
          await onFinish?.('Hello World', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({ content: 'Hello' }),
        }),
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle reasoning chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ text: 'Thinking...', type: 'reasoning' } as any);
          await onMessageHandle?.({ text: 'Answer', type: 'text' } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({ reasoning: { content: 'Thinking...' } }),
        }),
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      streamSpy.mockRestore();
    });

    it('should skip grounding when citations are empty', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            grounding: { citations: [], searchQueries: [] },
            type: 'grounding',
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      // Should not dispatch when citations are empty
      const groundingCalls = dispatchSpy.mock.calls.filter((call) => {
        const dispatch = call[0];
        return dispatch?.type === 'updateMessage' && 'value' in dispatch && dispatch.value?.search;
      });
      expect(groundingCalls).toHaveLength(0);

      streamSpy.mockRestore();
    });

    it('should handle grounding chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            grounding: {
              citations: [{ title: 'Example', url: 'https://example.com' }],
              searchQueries: ['test query'],
            },
            type: 'grounding',
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({
            search: expect.objectContaining({
              citations: expect.any(Array),
            }),
          }),
        }),
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle base64 image chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            image: { data: 'base64data', id: 'img-1' },
            images: [{ data: 'base64data', id: 'img-1' }],
            type: 'base64_image',
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({
            imageList: expect.any(Array),
          }),
        }),
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle empty tool call arguments', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { function: { arguments: '', name: 'test' }, id: 'tool-1', type: 'function' },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(true);
      });

      streamSpy.mockRestore();
    });

    it('should update message with traceId when provided in onFinish', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const traceId = 'test-trace-123';

      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, { traceId } as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ traceId }),
        expect.objectContaining({
          diagnosticOperation: 'finalize_assistant_message',
          showNotification: false,
        }),
      );

      streamSpy.mockRestore();
    });
  });

  describe('internal_resendMessage', () => {
    it('should not resend when message does not exist', async () => {
      const { result } = renderHook(() => useChatStore());
      const coreProcessSpy = vi.fn();

      act(() => {
        setupStoreWithMessages([]);
        useChatStore.setState({ internal_coreProcessMessage: coreProcessSpy });
      });

      await act(async () => {
        await result.current.internal_resendMessage('non-existent-id');
      });

      expect(coreProcessSpy).not.toHaveBeenCalled();
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
    });

    describe('context generation', () => {
      it('rewinds every message after the anchor before regenerating', async () => {
        const { result } = renderHook(() => useChatStore());
        const user = createMockMessage({ id: 'user-1', role: 'user' });
        const error = createMockMessage({
          error: { message: 'gateway failed', type: 504 } as any,
          id: 'error-1',
          parentId: user.id,
          role: 'assistant',
        });
        const messages = [
          user,
          error,
          createMockMessage({ id: 'diagnostic-1', parentId: user.id, role: 'assistant' }),
          createMockMessage({ id: 'user-2', role: 'user' }),
          createMockMessage({ id: 'assistant-2', parentId: 'user-2', role: 'assistant' }),
        ];
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);

        act(() => {
          useChatStore.setState({ messagesMap: { [key]: messages } });
        });

        await act(async () => {
          await result.current.internal_resendMessage(error.id);
        });

        expect(messageService.rewindMessages).toHaveBeenCalledWith([
          'error-1',
          'diagnostic-1',
          'user-2',
          'assistant-2',
        ]);
        expect(useChatStore.getState().messagesMap[key].map(({ id }) => id)).toEqual(['user-1']);
        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          [expect.objectContaining({ id: 'user-1' })],
          'user-1',
          expect.any(Object),
        );
      });

      it('clears discarded error details, tool UI, and loading diagnostics', async () => {
        const { result } = renderHook(() => useChatStore());
        const user = createMockMessage({ id: 'user-1', role: 'user' });
        const error = createMockMessage({
          error: { message: 'gateway failed', type: 504 } as any,
          id: 'error-1',
          parentId: user.id,
          role: 'assistant',
        });
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);

        act(() => {
          useChatStore.setState({
            chatLoadingIds: [error.id],
            mainSendMessageOperations: {
              [key]: { inputSendErrorMsg: 'request failed', isLoading: false },
            },
            messageInToolsCallingIds: [error.id],
            messageLoadingIds: [error.id],
            messagesMap: { [key]: [user, error] },
            pluginApiLoadingIds: [error.id],
            portalMessageDetail: error.id,
            portalToolMessage: { id: error.id, identifier: 'tool' },
            reasoningLoadingIds: [error.id],
            searchWorkflowLoadingIds: [error.id],
            showPortal: true,
            toolCallingStreamIds: { [error.id]: [true] },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(error.id);
        });

        const state = useChatStore.getState();
        expect(state.portalMessageDetail).toBeUndefined();
        expect(state.portalToolMessage).toBeUndefined();
        expect(state.showPortal).toBe(false);
        expect(state.mainSendMessageOperations[key]?.inputSendErrorMsg).toBeUndefined();
        expect(state.chatLoadingIds).toEqual([]);
        expect(state.messageInToolsCallingIds).toEqual([]);
        expect(state.messageLoadingIds).toEqual([]);
        expect(state.pluginApiLoadingIds).toEqual([]);
        expect(state.reasoningLoadingIds).toEqual([]);
        expect(state.searchWorkflowLoadingIds).toEqual([]);
        expect(state.toolCallingStreamIds).not.toHaveProperty(error.id);
      });

      it('restores optimistic state and does not generate when persistence fails', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'user-1', role: 'user' }),
          createMockMessage({ id: 'assistant-1', parentId: 'user-1', role: 'assistant' }),
        ];
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);
        vi.mocked(messageService.rewindMessages).mockRejectedValueOnce(new Error('db unavailable'));

        act(() => {
          useChatStore.setState({ messagesMap: { [key]: messages } });
        });

        await act(async () => {
          await result.current.internal_resendMessage('assistant-1');
        });

        expect(useChatStore.getState().messagesMap[key]).toEqual(messages);
        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
      });

      it('ignores another retry while a rewind transaction is in flight', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'user-1', role: 'user' }),
          createMockMessage({ id: 'assistant-1', parentId: 'user-1', role: 'assistant' }),
          createMockMessage({ id: 'user-2', role: 'user' }),
          createMockMessage({ id: 'assistant-2', parentId: 'user-2', role: 'assistant' }),
        ];
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);
        let finishRewind: (() => void) | undefined;
        vi.mocked(messageService.rewindMessages).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishRewind = () => resolve({ messageIds: ['assistant-2'], threadIds: [] });
            }),
        );

        act(() => {
          useChatStore.setState({ messagesMap: { [key]: messages } });
        });

        await act(async () => {
          const firstRetry = result.current.internal_resendMessage('assistant-2');
          await waitFor(() => {
            expect(useChatStore.getState().messageRetryingIds.length).toBeGreaterThan(0);
          });
          await result.current.internal_resendMessage('assistant-1');
          finishRewind?.();
          await firstRetry;
        });

        expect(messageService.rewindMessages).toHaveBeenCalledTimes(1);
        expect(messageService.rewindMessages).toHaveBeenCalledWith(['assistant-2']);
      });

      it('clears the retry lock after switching conversation', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'user-1', role: 'user' }),
          createMockMessage({ id: 'assistant-1', parentId: 'user-1', role: 'assistant' }),
        ];
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);
        vi.mocked(messageService.rewindMessages).mockImplementationOnce(async () => {
          useChatStore.setState({ activeId: 'other-session', activeTopicId: undefined });
          return { messageIds: [], threadIds: [] };
        });

        act(() => {
          useChatStore.setState({ messagesMap: { [key]: messages } });
        });

        await act(async () => {
          await result.current.internal_resendMessage('assistant-1');
        });

        expect(useChatStore.getState().messageRetryingIds).toEqual([]);
      });

      it('routes a retained group user message without creating a duplicate', async () => {
        const { result } = renderHook(() => useChatStore());
        const user = createMockMessage({
          groupId: TEST_IDS.SESSION_ID,
          id: 'group-user',
          role: 'user',
        });
        const error = createMockMessage({
          groupId: TEST_IDS.SESSION_ID,
          id: 'group-error',
          parentId: user.id,
          role: 'supervisor',
        });
        const key = chatSelectors.currentChatKey(useChatStore.getState() as any);
        const routeGroupMessage = vi
          .spyOn(result.current, 'internal_routeGroupUserMessage')
          .mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_cancelSupervisorDecision').mockImplementation(() => {});
        vi.spyOn(result.current, 'internal_updateSupervisorTodos').mockImplementation(() => {});

        act(() => {
          useChatStore.setState({
            activeSessionType: 'group',
            messagesMap: { [key]: [user, error] },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(error.id);
        });

        expect(routeGroupMessage).toHaveBeenCalledWith(
          TEST_IDS.SESSION_ID,
          { content: user.content, targetId: user.targetId },
          true,
          7,
        );
        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
        expect(useChatStore.getState().messagesMap[key]).toEqual([user]);
      });

      it('should generate correct context for user role message', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'msg-1', role: 'system' }),
          createMockMessage({ id: TEST_IDS.MESSAGE_ID, meta: { avatar: '😀' }, role: 'user' }),
          createMockMessage({ id: 'msg-3', role: 'assistant' }),
        ];

        act(() => {
          useChatStore.setState({
            messagesMap: {
              [chatSelectors.currentChatKey(useChatStore.getState() as any)]: messages,
            },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(TEST_IDS.MESSAGE_ID);
        });

        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ id: 'msg-1' }),
            expect.objectContaining({ id: TEST_IDS.MESSAGE_ID }),
          ]),
          TEST_IDS.MESSAGE_ID,
          expect.objectContaining({ traceId: undefined }),
        );
      });

      it('should generate correct context for assistant role message', async () => {
        const { result } = renderHook(() => useChatStore());
        const parentId = 'msg-2';
        const messages = [
          createMockMessage({ id: 'msg-1', role: 'system' }),
          createMockMessage({ id: parentId, meta: { avatar: '😀' }, role: 'user' }),
          createMockMessage({ id: TEST_IDS.MESSAGE_ID, parentId, role: 'assistant' }),
        ];

        act(() => {
          useChatStore.setState({
            messagesMap: {
              [chatSelectors.currentChatKey(useChatStore.getState() as any)]: messages,
            },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(TEST_IDS.MESSAGE_ID);
        });

        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ id: 'msg-1' }),
            expect.objectContaining({ id: parentId }),
          ]),
          parentId,
          expect.objectContaining({ traceId: undefined }),
        );
      });

      it('should not process when context is empty', async () => {
        const { result } = renderHook(() => useChatStore());

        act(() => {
          useChatStore.setState({
            messagesMap: {
              [chatSelectors.currentChatKey(useChatStore.getState() as any)]: [],
            },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(TEST_IDS.MESSAGE_ID);
        });

        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
      });

      it('should generate correct context for tool role message', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'msg-1', role: 'user' }),
          createMockMessage({ id: 'msg-2', role: 'assistant' }),
          createMockMessage({ id: TEST_IDS.MESSAGE_ID, role: 'tool' }),
        ];

        act(() => {
          useChatStore.setState({
            messagesMap: {
              [chatSelectors.currentChatKey(useChatStore.getState() as any)]: messages,
            },
          });
        });

        await act(async () => {
          await result.current.internal_resendMessage(TEST_IDS.MESSAGE_ID);
        });

        // For tool role, it processes all messages up to tool but uses last user message as parentId
        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.any(Array),
          'msg-1', // parentId is the last user message
          expect.objectContaining({ traceId: undefined }),
        );
      });
    });
  });

  describe('internal_toggleChatLoading', () => {
    it('should enable loading state with new abort controller', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatLoading(true, TEST_IDS.MESSAGE_ID, 'test-action');
      });

      const state = useChatStore.getState();
      expect(state.chatLoadingIdsAbortController).toBeInstanceOf(AbortController);
      expect(state.chatLoadingIds).toEqual([TEST_IDS.MESSAGE_ID]);
    });

    it('should disable loading state and clear abort controller', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatLoading(true, TEST_IDS.MESSAGE_ID, 'start');
        result.current.internal_toggleChatLoading(false, undefined, 'stop');
      });

      const state = useChatStore.getState();
      expect(state.chatLoadingIdsAbortController).toBeUndefined();
      expect(state.chatLoadingIds).toEqual([]);
    });

    it('preserves the abort controller when one loading id remains', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatLoading(true, 'msg-a', 'start-a');
        result.current.internal_toggleChatLoading(true, 'msg-b', 'start-b');
        result.current.internal_toggleChatLoading(false, 'msg-a', 'stop-a');
      });

      const state = useChatStore.getState();
      expect(state.chatLoadingIdsAbortController).toBeInstanceOf(AbortController);
      expect(state.chatLoadingIds).toEqual(['msg-b']);
    });

    it('still aborts a later generation after an earlier one clears its loading id', async () => {
      const sessionId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const mainLaneKey = `${messageMapKey(sessionId, topicId)}:main`;
      const sharedController = new AbortController();
      act(() => {
        useChatStore.setState({
          activeId: sessionId,
          activeTopicId: topicId,
          chatLoadingAbortControllersByLane: { [mainLaneKey]: sharedController },
          chatLoadingIds: ['msg-a', 'msg-b'],
          chatLoadingIdsAbortController: sharedController,
          chatLoadingLaneByMessageId: {
            'msg-a': mainLaneKey,
            'msg-b': mainLaneKey,
          },
        });
      });

      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatLoading(false, 'msg-a', 'generation-a-end');
      });

      expect(useChatStore.getState().chatLoadingIdsAbortController).toBe(sharedController);
      expect(useChatStore.getState().chatLoadingIds).toEqual(['msg-b']);

      await act(async () => {
        await result.current.stopGenerateMessage();
      });

      expect(sharedController.signal.aborted).toBe(true);
    });

    it('should manage beforeunload event listener', () => {
      const { result } = renderHook(() => useChatStore());
      const addListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

      act(() => {
        result.current.internal_toggleChatLoading(true, TEST_IDS.MESSAGE_ID, 'start');
      });

      expect(addListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      act(() => {
        result.current.internal_toggleChatLoading(false, undefined, 'stop');
      });

      expect(removeListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('should reuse existing abort controller', () => {
      const existingController = new AbortController();

      act(() => {
        useChatStore.setState({ chatLoadingIdsAbortController: existingController });
      });

      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatLoading(true, TEST_IDS.MESSAGE_ID, 'test');
      });

      const state = useChatStore.getState();
      expect(state.chatLoadingIdsAbortController).toStrictEqual(existingController);
    });
  });

  describe('internal_toggleToolCallingStreaming', () => {
    it('should track tool calling stream status', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, [true]);
      });

      expect(result.current.toolCallingStreamIds[TEST_IDS.MESSAGE_ID]).toEqual([true]);
    });

    it('should clear tool calling stream status', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, [true]);
        result.current.internal_toggleToolCallingStreaming(TEST_IDS.MESSAGE_ID, undefined);
      });

      expect(result.current.toolCallingStreamIds[TEST_IDS.MESSAGE_ID]).toBeUndefined();
    });
  });

  describe('internal_toggleSearchWorkflow', () => {
    it('should enable search workflow loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleSearchWorkflow(true, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.searchWorkflowLoadingIds).toEqual([TEST_IDS.MESSAGE_ID]);
    });

    it('should disable search workflow loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleSearchWorkflow(true, TEST_IDS.MESSAGE_ID);
        result.current.internal_toggleSearchWorkflow(false, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.searchWorkflowLoadingIds).toEqual([]);
    });
  });

  describe('internal_toggleChatReasoning', () => {
    it('should enable reasoning loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatReasoning(true, TEST_IDS.MESSAGE_ID, 'test-action');
      });

      const state = useChatStore.getState();
      expect(state.reasoningLoadingIds).toEqual([TEST_IDS.MESSAGE_ID]);
    });

    it('should disable reasoning loading state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleChatReasoning(true, TEST_IDS.MESSAGE_ID, 'start');
        result.current.internal_toggleChatReasoning(false, TEST_IDS.MESSAGE_ID, 'stop');
      });

      const state = useChatStore.getState();
      expect(state.reasoningLoadingIds).toEqual([]);
    });
  });

  describe('internal_toggleMessageInToolsCalling', () => {
    it('should enable tools calling state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleMessageInToolsCalling(true, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.messageInToolsCallingIds).toEqual([TEST_IDS.MESSAGE_ID]);
    });

    it('should disable tools calling state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_toggleMessageInToolsCalling(true, TEST_IDS.MESSAGE_ID);
        result.current.internal_toggleMessageInToolsCalling(false, TEST_IDS.MESSAGE_ID);
      });

      const state = useChatStore.getState();
      expect(state.messageInToolsCallingIds).toEqual([]);
    });
  });

  describe('internal_resendMessage with custom params', () => {
    it('should use provided messages instead of store messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const customMessages = [createMockMessage({ id: 'custom-msg', role: 'user' })];

      await act(async () => {
        await result.current.internal_resendMessage('custom-msg', { messages: customMessages });
      });

      expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'custom-msg' })]),
        'custom-msg',
        expect.anything(),
      );
    });

    it('should handle assistant message without parentId', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [
        createMockMessage({ id: 'msg-1', role: 'user' }),
        createMockMessage({ id: TEST_IDS.MESSAGE_ID, parentId: undefined, role: 'assistant' }),
      ];

      act(() => {
        useChatStore.setState({
          messagesMap: {
            [chatSelectors.currentChatKey(useChatStore.getState() as any)]: messages,
          },
        });
      });

      await act(async () => {
        await result.current.internal_resendMessage(TEST_IDS.MESSAGE_ID);
      });

      // Should handle the case where parentId is not found
      expect(result.current.internal_coreProcessMessage).toHaveBeenCalled();
    });
  });

  describe('internal_routeGroupUserMessage', () => {
    it('runs the supervisor immediately for a retained retry message', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-1';
      const triggerSupervisor = vi
        .spyOn(result.current, 'internal_triggerSupervisorDecision')
        .mockResolvedValue(undefined);
      const triggerDebounced = vi
        .spyOn(result.current, 'internal_triggerSupervisorDecisionDebounced')
        .mockImplementation(() => {});

      act(() => {
        useChatStore.setState({
          groupMaps: {
            [groupId]: { config: { enableSupervisor: true } } as any,
          },
        });
      });

      await act(async () => {
        await result.current.internal_routeGroupUserMessage(
          groupId,
          { content: 'retry this turn' },
          true,
        );
      });

      expect(triggerSupervisor).toHaveBeenCalledWith(groupId, TEST_IDS.TOPIC_ID, true, 7);
      expect(triggerDebounced).not.toHaveBeenCalled();
    });
  });
});
