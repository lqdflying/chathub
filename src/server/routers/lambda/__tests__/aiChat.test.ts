// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/core/db-adaptor';
import { AiChatService } from '@/server/services/aiChat';

import { aiChatRouter } from '../aiChat';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));
vi.mock('@/database/models/message');
vi.mock('@/database/models/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/utils/server', () => ({
  getXorPayload: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(),
}));

describe('aiChatRouter', () => {
  const mockUser = [{ version: 'version-1' }];
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

  it('should create topic optionally, create user/assistant messages, and return payload', async () => {
    const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi
      .fn()
      .mockResolvedValue({ messages: [{ id: 'm-user' }, { id: 'm-assistant' }], topics: [{}] });

    vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const input = {
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
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

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: expect.any(String),
        fromModel: 'gpt-4o',
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        topicId: 't1',
      }),
    );

    expect(mockGet).toHaveBeenCalledWith({ includeTopic: true, sessionId: 's1', topicId: 't1' });
    expect(res.assistantMessageId).toBe('m-assistant');
    expect(res.userMessageId).toBe('m-user');
    expect(res.isCreateNewTopic).toBe(true);
    expect(res.topicId).toBe('t1');
    expect(res.messages?.length).toBe(2);
    expect(res.topics?.length).toBe(1);
  });

  it('should reuse existing topic when topicId provided', async () => {
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const topics = [{ id: 't-exist', lastActivityAt: new Date('2026-07-21T16:00:00.000Z') }];
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
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

  it('should pass threadId to both user and assistant messages when provided', async () => {
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
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

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        threadId: 'thread-123',
        topicId: 't1',
      }),
    );
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
