import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { UploadFileItem } from '@/types/files/upload';

import { useChatStore } from '../../../../store';
import { TEST_CONTENT, TEST_IDS, createMockMessage, createMockMessages } from './fixtures';
import {
  resetTestEnvironment,
  setupMockSelectors,
  setupStoreWithMessages,
  spyOnChatService,
  spyOnMessageService,
} from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

const realCoreProcessMessage = useChatStore.getState().internal_coreProcessMessage;

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();

  // Setup default spies that most tests need
  spyOnMessageService();
  // ✅ Removed spyOnChatService() - tests should spy chatService only when needed

  // Setup common mock methods that most tests need
  act(() => {
    useSessionStore.setState({ triggerSessionUpdate: vi.fn() });
    useChatStore.setState({
      internal_fetchMessages: vi.fn(),
      refreshMessages: vi.fn(),
      refreshThreads: vi.fn(),
      refreshTopic: vi.fn(),
      internal_coreProcessMessage: vi.fn(),
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
        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
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
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY, files: [] });
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

        expect(messageService.createMessage).toHaveBeenCalledWith({
          content: TEST_CONTENT.USER_MESSAGE,
          files: undefined,
          role: 'user',
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        });
        expect(result.current.internal_coreProcessMessage).toHaveBeenCalled();
      });

      it('should send message with files attached', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE, files });
        });

        expect(messageService.createMessage).toHaveBeenCalledWith({
          content: TEST_CONTENT.USER_MESSAGE,
          files: [TEST_IDS.FILE_ID],
          role: 'user',
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        });
      });

      it('should send files without message content', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY, files });
        });

        expect(messageService.createMessage).toHaveBeenCalledWith({
          content: TEST_CONTENT.EMPTY,
          files: [TEST_IDS.FILE_ID],
          role: 'user',
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        });
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
        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
      });

      it('should handle message creation errors gracefully', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(messageService, 'createMessage').mockRejectedValue(
          new Error('create message error'),
        );

        await act(async () => {
          try {
            await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
          } catch {
            // Expected to throw
          }
        });

        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
      });
    });

    describe('auto-create topic', () => {
      const TOPIC_THRESHOLD = 5;

      it('should create topic when threshold is reached and feature is enabled', async () => {
        const { result } = renderHook(() => useChatStore());

        const createTopicMock = vi.fn(() => Promise.resolve(TEST_IDS.NEW_TOPIC_ID));
        const switchTopicMock = vi.fn();

        act(() => {
          setupMockSelectors({
            agentConfig: {
              enableAutoCreateTopic: true,
              autoCreateTopicThreshold: TOPIC_THRESHOLD,
            },
          });

          useChatStore.setState({
            activeTopicId: undefined,
            messagesMap: {
              [messageMapKey(TEST_IDS.SESSION_ID)]: createMockMessages(TOPIC_THRESHOLD),
            },
            createTopic: createTopicMock,
            switchTopic: switchTopicMock,
          });
        });

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(createTopicMock).toHaveBeenCalled();
        expect(switchTopicMock).toHaveBeenCalledWith(TEST_IDS.NEW_TOPIC_ID, true);
      });
    });

    describe('RAG integration', () => {
      it('should include RAG query when RAG is enabled', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(true);

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.RAG_QUERY });
        });

        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(String),
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
        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(String),
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
            message: TEST_CONTENT.USER_MESSAGE,
            isWelcomeQuestion: true,
          });
        });

        expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          { isWelcomeQuestion: true },
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

        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
      });
    });

    describe('topic creation flow', () => {
      it('should handle tempMessage during topic creation', async () => {
        setupMockSelectors({
          chatConfig: { enableAutoCreateTopic: true, autoCreateTopicThreshold: 2 },
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
        vi.spyOn(result.current, 'switchTopic').mockResolvedValue();

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(createTmpMessageSpy).toHaveBeenCalled();
        expect(toggleMessageLoadingSpy).toHaveBeenCalledWith(true, 'temp-id');
        expect(createTopicMock).toHaveBeenCalled();
      });

      it('should call summaryTopicTitle after processing when new topic created', async () => {
        setupMockSelectors({
          chatConfig: { enableAutoCreateTopic: true, autoCreateTopicThreshold: 2 },
        });

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
          setupStoreWithMessages(createMockMessages(5));
        });

        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'createTopic').mockResolvedValue(TEST_IDS.NEW_TOPIC_ID);
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-id');
        vi.spyOn(result.current, 'internal_fetchMessages').mockResolvedValue();
        vi.spyOn(result.current, 'switchTopic').mockResolvedValue();

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
          chatConfig: { enableAutoCreateTopic: true, autoCreateTopicThreshold: 2 },
        });

        act(() => {
          useChatStore.setState({ activeTopicId: undefined });
          setupStoreWithMessages(createMockMessages(5));
        });

        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'createTopic').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createTmpMessage').mockReturnValue('temp-id');
        const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleMessageLoading');
        const updateTopicLoadingSpy = vi.spyOn(result.current, 'internal_updateTopicLoading');

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        // Should still call the AI processing even if topic creation fails
        expect(result.current.internal_coreProcessMessage).toHaveBeenCalled();
        expect(updateTopicLoadingSpy).not.toHaveBeenCalled();
      });
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
    it('should abort generation and clear loading state when controller exists', () => {
      const abortController = new AbortController();

      act(() => {
        useChatStore.setState({ chatLoadingIdsAbortController: abortController });
      });

      const { result } = renderHook(() => useChatStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleChatLoading');

      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(abortController.signal.aborted).toBe(true);
      expect(toggleLoadingSpy).toHaveBeenCalledWith(false, undefined, expect.any(String));
    });

    it('should do nothing when abort controller is not set', () => {
      act(() => {
        useChatStore.setState({ chatLoadingIdsAbortController: undefined });
      });

      const { result } = renderHook(() => useChatStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleChatLoading');

      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(toggleLoadingSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_coreProcessMessage', () => {
    it('should process user message and generate AI response', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
      });

      // ✅ Spy the direct dependency instead of chatService
      const fetchAIChatSpy = vi
        .spyOn(result.current, 'internal_fetchAIChatMessage')
        .mockResolvedValue({ isFunctionCall: false, content: 'AI response' });

      const createMessageSpy = vi
        .spyOn(messageService, 'createMessage')
        .mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id);
      });

      expect(createMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: LOADING_FLAT,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      expect(fetchAIChatSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('should handle RAG flow when ragQuery is provided', async () => {
      act(() => {
        useChatStore.setState({ internal_coreProcessMessage: realCoreProcessMessage });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = createMockMessage({
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.RAG_QUERY,
      });

      const retrieveChunksSpy = vi
        .spyOn(result.current, 'internal_retrieveChunks')
        .mockResolvedValue({
          chunks: [{ id: 'chunk-1', similarity: 0.9, text: 'chunk text' }] as any,
          queryId: 'query-1',
          rewriteQuery: 'rewritten query',
        });

      vi.spyOn(messageService, 'createMessage').mockResolvedValue(TEST_IDS.ASSISTANT_MESSAGE_ID);

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id, {
          ragQuery: TEST_CONTENT.RAG_QUERY,
        });
      });

      expect(retrieveChunksSpy).toHaveBeenCalledWith(
        TEST_IDS.USER_MESSAGE_ID,
        TEST_CONTENT.RAG_QUERY,
        [],
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
        .mockResolvedValue({ isFunctionCall: false, content: '' });

      vi.spyOn(messageService, 'createMessage').mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.internal_coreProcessMessage([userMessage], userMessage.id);
      });

      expect(fetchAIChatSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_fetchAIChatMessage', () => {
    it('should fetch and return AI chat response', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // ✅ Mock chatService instead of global fetch
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          // Simulate text chunks streaming
          await onMessageHandle?.({ type: 'text', text: TEST_CONTENT.AI_RESPONSE } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(false);
        expect(response.content).toEqual(TEST_CONTENT.AI_RESPONSE);
      });

      streamSpy.mockRestore();
    });

    it('should handle streaming errors gracefully', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // ✅ Mock chatService to simulate error
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onErrorHandle }) => {
          await onErrorHandle?.({ type: 'InvalidProviderAPIKey', message: 'Network error' } as any);
        });

      const updateMessageErrorSpy = vi.spyOn(messageService, 'updateMessageError');

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          model: 'gpt-4o-mini',
          provider: 'openai',
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        });
      });

      expect(updateMessageErrorSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ type: 'InvalidProviderAPIKey' }),
      );

      streamSpy.mockRestore();
    });

    it('should handle tool call chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'tool_calls',
            isAnimationActives: [true],
            tool_calls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
          await onMessageHandle?.({ type: 'text', text: 'Hello' } as any);
          await onMessageHandle?.({ type: 'text', text: ' World' } as any);
          await onFinish?.('Hello World', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
          await onMessageHandle?.({ type: 'reasoning', text: 'Thinking...' } as any);
          await onMessageHandle?.({ type: 'text', text: 'Answer' } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
            type: 'grounding',
            grounding: { citations: [], searchQueries: [] },
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
            type: 'grounding',
            grounding: {
              citations: [{ url: 'https://example.com', title: 'Example' }],
              searchQueries: ['test query'],
            },
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
            type: 'base64_image',
            image: { id: 'img-1', data: 'base64data' },
            images: [{ id: 'img-1', data: 'base64data' }],
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '' } },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
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
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ traceId }),
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
          await Promise.resolve();
          await result.current.internal_resendMessage('assistant-1');
          finishRewind?.();
          await firstRetry;
        });

        expect(messageService.rewindMessages).toHaveBeenCalledTimes(1);
        expect(messageService.rewindMessages).toHaveBeenCalledWith(['assistant-2']);
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
        );
        expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
        expect(useChatStore.getState().messagesMap[key]).toEqual([user]);
      });

      it('should generate correct context for user role message', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [
          createMockMessage({ id: 'msg-1', role: 'system' }),
          createMockMessage({ id: TEST_IDS.MESSAGE_ID, role: 'user', meta: { avatar: '😀' } }),
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
          createMockMessage({ id: parentId, role: 'user', meta: { avatar: '😀' } }),
          createMockMessage({ id: TEST_IDS.MESSAGE_ID, role: 'assistant', parentId }),
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
        createMockMessage({ id: TEST_IDS.MESSAGE_ID, role: 'assistant', parentId: undefined }),
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

      expect(triggerSupervisor).toHaveBeenCalledWith(groupId, TEST_IDS.TOPIC_ID, true);
      expect(triggerDebounced).not.toHaveBeenCalled();
    });
  });
});
