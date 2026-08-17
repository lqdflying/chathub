// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/core/db-adaptor';
import { AiChatService } from '@/server/services/aiChat';
import { isDurableConversationGenerationEnabled } from '@/server/services/conversationGeneration/featureFlag';

import { aiChatRouter } from '../aiChat';

const durableMocks = vi.hoisted(() => ({
  enqueueInTransaction: vi.fn(),
  findByIdempotencyKey: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));
vi.mock('@/database/models/message');
vi.mock('@/database/models/topic');
vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    findByIdempotencyKey = durableMocks.findByIdempotencyKey;
  },
}));
vi.mock('@/database/utils/idGenerator', () => ({
  idGenerator: vi.fn(() => 'msg_1234567890ABCD'),
}));
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/services/conversationGeneration/featureFlag', () => ({
  isDurableConversationGenerationEnabled: vi.fn(async () => false),
}));
vi.mock('@/server/services/conversationGeneration/credentials', () => ({
  resolveConversationRuntimePayload: vi.fn(),
}));
vi.mock('@/server/services/conversationGeneration/service', () => ({
  ConversationGenerationService: class {
    enqueueInTransaction = durableMocks.enqueueInTransaction;
  },
}));
vi.mock('@/utils/server', () => ({
  getXorPayload: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(),
}));

describe('aiChatRouter', () => {
  const mockUser = [{ version: 7 }];
  const mockTransaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: async () => mockUser,
          }),
        }),
      }),
    }),
  };
  const mockCtx = {
    serverDB: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => mockUser,
          }),
        }),
      }),
      transaction: async (callback: (transaction: typeof mockTransaction) => Promise<unknown>) =>
        callback(mockTransaction),
    },
    userId: 'u1',
  };

  vi.mocked(getServerDB).mockResolvedValue(mockCtx.serverDB as any);

  beforeEach(() => {
    vi.clearAllMocks();
    durableMocks.findByIdempotencyKey.mockResolvedValue(undefined);
    vi.mocked(isDurableConversationGenerationEnabled).mockResolvedValue(false);
  });

  it('should create a topic and user message while reserving the assistant id', async () => {
    const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
    const mockCreateMessage = vi.fn().mockResolvedValueOnce({ id: 'm-user' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [{ id: 'm-user' }], topics: [{}] });

    vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const input = {
      newTopic: { title: 'T', topicMessageIds: ['a', 'b'] },
      newUserMessage: { content: 'hi', files: ['f1'] },
      sessionId: 's1',
    } as any;

    const res = await caller.sendMessageInServer(input);

    expect(mockCreateTopic).toHaveBeenCalledWith({
      messages: ['a', 'b'],
      sessionId: 's1',
      title: 'T',
    });

    expect(mockCreateMessage).toHaveBeenNthCalledWith(1, {
      content: 'hi',
      files: ['f1'],
      role: 'user',
      sessionId: 's1',
      topicId: 't1',
    });

    expect(mockCreateMessage).toHaveBeenCalledTimes(1);

    expect(mockGet).toHaveBeenCalledWith({ includeTopic: true, sessionId: 's1', topicId: 't1' });
    expect(res.assistantMessageId).toBe('msg_1234567890ABCD');
    expect(res.userMessageId).toBe('m-user');
    expect(res.isCreateNewTopic).toBe(true);
    expect(res.topicId).toBe('t1');
    expect(res.messages?.length).toBe(1);
    expect(res.topics?.length).toBe(1);
  });

  it('should reuse existing topic when topicId provided', async () => {
    const mockCreateMessage = vi.fn().mockResolvedValueOnce({ id: 'm-user' });
    const topics = [{ id: 't-exist', lastActivityAt: new Date('2026-07-21T16:00:00.000Z') }];
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't-exist',
    } as any);

    expect(mockCreateMessage).toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith({
      includeTopic: true,
      sessionId: 's1',
      topicId: 't-exist',
    });
    expect(res.isCreateNewTopic).toBe(false);
    expect(res.topicId).toBe('t-exist');
    expect(res.topics).toEqual(topics);
  });

  it('should pass threadId to the user message when provided', async () => {
    const mockCreateMessage = vi.fn().mockResolvedValueOnce({ id: 'm-user' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    await caller.sendMessageInServer({
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      threadId: 'thread-123',
      topicId: 't1',
    } as any);

    expect(mockCreateMessage).toHaveBeenNthCalledWith(1, {
      content: 'hi',
      role: 'user',
      sessionId: 's1',
      threadId: 'thread-123',
      topicId: 't1',
    });

    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
  });

  it('returns an existing durable send from the write lock without duplicate messages', async () => {
    vi.mocked(isDurableConversationGenerationEnabled).mockResolvedValue(true);
    durableMocks.findByIdempotencyKey.mockResolvedValue({
      assistantMessageId: 'msg_existing0001',
      config: { model: 'gpt-4o', provider: 'openai' },
      id: 'operation-existing',
      kind: 'chat',
      sessionId: 's1',
      threadId: null,
      topicId: 't1',
      userMessageId: 'message-user-existing',
    });
    const mockCreateMessage = vi.fn();
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [] });
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);
    const result = await caller.sendMessageInServer({
      expectedConversationVersion: 7,
      generation: {
        config: { model: 'gpt-4o', provider: 'openai' },
        idempotencyKey: 'chat-send-existing',
      },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't1',
    });

    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(durableMocks.enqueueInTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      assistantMessageId: 'msg_existing0001',
      operationId: 'operation-existing',
      userMessageId: 'message-user-existing',
    });
  });

  it('enqueues a new durable send with replacement and conversation-version guards', async () => {
    vi.mocked(isDurableConversationGenerationEnabled).mockResolvedValue(true);
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'message-user-new' })
      .mockResolvedValueOnce({ id: 'msg_1234567890ABCD' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [] });
    durableMocks.enqueueInTransaction.mockResolvedValue({
      assistantMessageId: 'msg_1234567890ABCD',
      id: 'operation-new',
      userMessageId: 'message-user-new',
    });
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);
    const result = await caller.sendMessageInServer({
      expectedConversationVersion: 7,
      generation: {
        config: { model: 'gpt-4o', provider: 'openai' },
        idempotencyKey: 'chat-send-new-key',
      },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't1',
    });

    expect(durableMocks.enqueueInTransaction).toHaveBeenCalledWith(
      mockTransaction,
      expect.objectContaining({
        conversationVersion: 7,
        expectedConversationVersion: 7,
        idempotencyKey: 'chat-send-new-key',
        replaceActive: true,
      }),
    );
    expect(result.operationId).toBe('operation-new');
  });

  it('creates the reserved assistant placeholder after validating its parent context', async () => {
    const parentMessage = {
      id: 'm-user',
      role: 'user',
      sessionId: 's1',
      threadId: 'thread-123',
      topicId: 't1',
    };
    const mockFindById = vi.fn(async (id: string) =>
      id === parentMessage.id ? parentMessage : undefined,
    );
    const mockCreateMessage = vi.fn().mockResolvedValue({ id: 'msg_1234567890ABCD' });
    const messages = [{ id: 'm-user' }, { id: 'msg_1234567890ABCD' }];
    const mockGet = vi.fn().mockResolvedValue({ messages });

    vi.mocked(MessageModel).mockImplementation(
      () => ({ create: mockCreateMessage, findById: mockFindById }) as any,
    );
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);
    const result = await caller.createAssistantMessageInServer({
      assistantMessageId: 'msg_1234567890ABCD',
      model: 'gpt-4o',
      parentId: 'm-user',
      provider: 'openai',
      sessionId: 's1',
      threadId: 'thread-123',
      topicId: 't1',
    });

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromModel: 'gpt-4o',
        fromProvider: 'openai',
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        threadId: 'thread-123',
        topicId: 't1',
      }),
      'msg_1234567890ABCD',
    );
    expect(result.messages).toEqual(messages);
  });

  it('treats an existing matching assistant placeholder as an idempotent retry', async () => {
    const parentMessage = {
      id: 'm-user',
      role: 'user',
      sessionId: 's1',
      threadId: null,
      topicId: 't1',
    };
    const assistantMessage = {
      id: 'msg_1234567890ABCD',
      model: 'gpt-4o',
      parentId: 'm-user',
      provider: 'openai',
      role: 'assistant',
      sessionId: 's1',
      threadId: null,
      topicId: 't1',
    };
    const mockFindById = vi.fn(async (id: string) =>
      id === parentMessage.id ? parentMessage : assistantMessage,
    );
    const mockCreateMessage = vi.fn();
    const mockGet = vi.fn().mockResolvedValue({ messages: [parentMessage, assistantMessage] });

    vi.mocked(MessageModel).mockImplementation(
      () => ({ create: mockCreateMessage, findById: mockFindById }) as any,
    );
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);
    await caller.createAssistantMessageInServer({
      assistantMessageId: 'msg_1234567890ABCD',
      model: 'gpt-4o',
      parentId: 'm-user',
      provider: 'openai',
      sessionId: 's1',
      topicId: 't1',
    });

    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('rejects an assistant placeholder whose parent belongs to another conversation', async () => {
    const mockCreateMessage = vi.fn();
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          create: mockCreateMessage,
          findById: vi.fn().mockResolvedValue({
            id: 'm-user',
            role: 'user',
            sessionId: 'other-session',
            threadId: null,
            topicId: 't1',
          }),
        }) as any,
    );

    const caller = aiChatRouter.createCaller(mockCtx as any);
    await expect(
      caller.createAssistantMessageInServer({
        assistantMessageId: 'msg_1234567890ABCD',
        model: 'gpt-4o',
        parentId: 'm-user',
        provider: 'openai',
        sessionId: 's1',
        topicId: 't1',
      }),
    ).rejects.toThrow('invalid assistant message context');
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  describe('outputJSON', () => {
    it('should successfully generate structured output', async () => {
      const { getXorPayload } = await import('@/utils/server');
      const { initModelRuntimeWithUserPayload } = await import('@/server/modules/ModelRuntime');

      const mockPayload = { apiKey: 'test-key' };
      const mockResult = { object: { age: 30, name: 'John' } };
      const mockGenerateObject = vi.fn().mockResolvedValue(mockResult);

      vi.mocked(getXorPayload).mockReturnValue(mockPayload);
      vi.mocked(initModelRuntimeWithUserPayload).mockReturnValue({
        generateObject: mockGenerateObject,
      } as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      const input = {
        keyVaultsPayload: 'encrypted-payload',
        messages: [{ content: 'test', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
        schema: {
          name: 'Person',
          schema: {
            properties: { age: { type: 'number' }, name: { type: 'string' } },
            type: 'object' as const,
          },
        },
      };

      const result = await caller.outputJSON(input);

      expect(getXorPayload).toHaveBeenCalledWith('encrypted-payload');
      expect(initModelRuntimeWithUserPayload).toHaveBeenCalledWith('openai', mockPayload);
      expect(mockGenerateObject).toHaveBeenCalledWith({
        messages: input.messages,
        model: 'gpt-4o',
        schema: input.schema,
        tools: undefined,
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw error when keyVaultsPayload is invalid', async () => {
      const { getXorPayload } = await import('@/utils/server');

      vi.mocked(getXorPayload).mockReturnValue(undefined as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      const input = {
        keyVaultsPayload: 'invalid-payload',
        messages: [],
        model: 'gpt-4o',
        provider: 'openai',
      };

      await expect(caller.outputJSON(input)).rejects.toThrow('keyVaultsPayload is not correct');
    });

    it('should handle tools parameter when provided', async () => {
      const { getXorPayload } = await import('@/utils/server');
      const { initModelRuntimeWithUserPayload } = await import('@/server/modules/ModelRuntime');

      const mockPayload = { apiKey: 'test-key' };
      const mockTools = [
        {
          function: {
            name: 'test',
            parameters: {
              properties: { input: { type: 'string' } },
              type: 'object' as const,
            },
          },
          type: 'function' as const,
        },
      ];
      const mockGenerateObject = vi.fn().mockResolvedValue({ object: {} });

      vi.mocked(getXorPayload).mockReturnValue(mockPayload);
      vi.mocked(initModelRuntimeWithUserPayload).mockReturnValue({
        generateObject: mockGenerateObject,
      } as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      const input = {
        keyVaultsPayload: 'encrypted-payload',
        messages: [],
        model: 'gpt-4o',
        provider: 'openai',
        tools: mockTools,
      };

      await caller.outputJSON(input);

      expect(mockGenerateObject).toHaveBeenCalledWith({
        messages: [],
        model: 'gpt-4o',
        schema: undefined,
        tools: mockTools,
      });
    });
  });

  describe('outputJSONWithContext', () => {
    it('returns the prepared provider request when structured generation rejects', async () => {
      const { getXorPayload } = await import('@/utils/server');
      const { initModelRuntimeWithUserPayload } = await import('@/server/modules/ModelRuntime');
      const providerRequest = {
        messages: [{ content: 'prepared request', role: 'user' }],
        metadata: { user_id: 'private-user' },
        model: 'gpt-4o',
      };
      const mockGenerateObject = vi.fn().mockImplementation(async (_payload, options) => {
        options.onRequestPrepared(providerRequest, { apiMode: 'generateObject' });
        throw new Error('provider rejected request');
      });

      vi.mocked(getXorPayload).mockReturnValue({
        apiKey: 'test-key',
        runtimeProvider: 'openai',
      });
      vi.mocked(initModelRuntimeWithUserPayload).mockReturnValue({
        generateObject: mockGenerateObject,
      } as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);
      const result = await caller.outputJSONWithContext({
        contextExportRequest: {
          allocation: { total: 0 },
          captureId: 'context-supervisor',
          continuationReason: 'initial',
          purpose: 'supervisor',
          requestId: 'request-supervisor',
          sequence: 0,
        },
        keyVaultsPayload: 'encrypted-payload',
        messages: [{ content: 'supervisor input', role: 'user' }],
        model: 'gpt-4o',
        provider: 'custom-openai',
      } as any);

      expect(result).toMatchObject({
        error: { message: 'provider rejected request' },
        snapshot: {
          captureId: 'context-supervisor',
          error: 'Provider request rejected during supervisor generation',
          metadata: {
            apiMode: 'generateObject',
            model: 'gpt-4o',
            provider: 'custom-openai',
            runtime: 'openai',
          },
          providerRequest: {
            messages: [{ content: 'prepared request', role: 'user' }],
            model: 'gpt-4o',
          },
          requestId: 'request-supervisor',
          status: 'error',
        },
        success: false,
      });
    });
  });
});
