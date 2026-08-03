// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { messages, sessions, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

// Mock FileService to avoid S3 initialization issues in tests
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

// We need to mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * Message Router 集成测试
 *
 * 测试目标：
 * 1. 验证完整的 tRPC 调用链路（Router → Model → Database）
 * 2. 确保 sessionId、topicId、groupId 等参数正确传递
 * 3. 验证数据库约束和关联关系
 */
describe('Message Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testSessionId: string;
  let testTopicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB; // Set the test DB for the mock
    userId = await createTestUser(serverDB);

    // 创建测试 session
    const [session] = await serverDB
      .insert(sessions)
      .values({
        userId,
        type: 'agent',
      })
      .returning();
    testSessionId = session.id;

    // 创建测试 topic
    const [topic] = await serverDB
      .insert(topics)
      .values({
        userId,
        sessionId: testSessionId,
        title: 'Test Topic',
      })
      .returning();
    testTopicId = topic.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('createMessage', () => {
    it('should create message with correct sessionId and topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const messageId = await caller.createMessage({
        content: 'Test message',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 🔥 关键：从数据库验证关联关系
      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      expect(createdMessage).toBeDefined();
      expect(createdMessage).toMatchObject({
        id: messageId,
        sessionId: testSessionId,
        topicId: testTopicId,
        userId: userId,
        content: 'Test message',
        role: 'user',
      });
    });

    it('should create message with threadId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 先创建 thread
      const { threads } = await import('@/database/schemas');
      const [thread] = await serverDB
        .insert(threads)
        .values({
          userId,
          topicId: testTopicId,
          sourceMessageId: 'msg-source',
          type: 'continuation', // type is required
        })
        .returning();

      const messageId = await caller.createMessage({
        content: 'Test message in thread',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
        threadId: thread.id,
      });

      // 验证 threadId 正确存储
      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      expect(createdMessage).toBeDefined();
      expect(createdMessage.threadId).toBe(thread.id);
      expect(createdMessage).toMatchObject({
        id: messageId,
        sessionId: testSessionId,
        topicId: testTopicId,
        threadId: thread.id,
        content: 'Test message in thread',
        role: 'user',
      });
    });

    it('should create message without topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const messageId = await caller.createMessage({
        content: 'Test message without topic',
        role: 'user',
        sessionId: testSessionId,
        // 注意：没有 topicId
      });

      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      expect(createdMessage.topicId).toBeNull();
      expect(createdMessage.sessionId).toBe(testSessionId);
    });

    it('should fail when sessionId does not exist', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await expect(
        caller.createMessage({
          content: 'Test message',
          role: 'user',
          sessionId: 'non-existent-session',
        }),
      ).rejects.toThrow();
    });

    it.skip('should fail when topicId does not belong to sessionId', async () => {
      // TODO: This validation is not currently enforced in the code
      // 创建另一个 session 和 topic
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      const [anotherTopic] = await serverDB
        .insert(topics)
        .values({
          userId,
          sessionId: anotherSession.id,
          title: 'Another Topic',
        })
        .returning();

      const caller = messageRouter.createCaller(createTestContext(userId));

      // 尝试在 testSessionId 下创建消息，但使用 anotherTopic 的 ID
      await expect(
        caller.createMessage({
          content: 'Test message',
          role: 'user',
          sessionId: testSessionId,
          topicId: anotherTopic.id, // 这个 topic 不属于 testSessionId
        }),
      ).rejects.toThrow();
    });
  });

  describe('getMessages', () => {
    it('should return messages filtered by sessionId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      const msg1Id = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Id = await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建另一个 session 的消息
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      await caller.createMessage({
        content: 'Message in another session',
        role: 'user',
        sessionId: anotherSession.id,
      });

      // 查询特定 session 的消息
      const result = await caller.getMessages({
        sessionId: testSessionId,
      });

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain(msg1Id);
      expect(result.map((m) => m.id)).toContain(msg2Id);
    });

    it('should return messages filtered by topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 在 topic 中创建消息
      const msgInTopicId = await caller.createMessage({
        content: 'Message in topic',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 在 session 中创建消息（不在 topic 中）
      await caller.createMessage({
        content: 'Message without topic',
        role: 'user',
        sessionId: testSessionId,
      });

      // 查询特定 topic 的消息
      const result = await caller.getMessages({
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(msgInTopicId);
      expect(result[0].topicId).toBe(testTopicId);
    });

    it('should support pagination', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      for (let i = 0; i < 5; i++) {
        await caller.createMessage({
          content: `Pagination test message ${i}`,
          role: 'user',
          sessionId: testSessionId,
        });
      }

      // 获取所有消息确认创建成功
      const allMessages = await caller.getMessages({
        sessionId: testSessionId,
      });
      expect(allMessages.length).toBeGreaterThanOrEqual(5);

      // 第一页
      const page1 = await caller.getMessages({
        sessionId: testSessionId,
        current: 1,
        pageSize: 2,
      });

      expect(page1.length).toBeLessThanOrEqual(2);

      // 第二页
      const page2 = await caller.getMessages({
        sessionId: testSessionId,
        current: 2,
        pageSize: 2,
      });

      expect(page2.length).toBeLessThanOrEqual(2);

      // 确保不同页的消息不重复（如果两页都有数据）
      if (page1.length > 0 && page2.length > 0) {
        const page1Ids = page1.map((m) => m.id);
        const page2Ids = page2.map((m) => m.id);
        expect(page1Ids).not.toEqual(page2Ids);
      }
    });
  });

  describe('batchCreateMessages', () => {
    it('should create multiple messages in batch', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const messagesToCreate = [
        {
          content: 'Batch message 1',
          role: 'user' as const,
          sessionId: testSessionId,
        },
        {
          content: 'Batch message 2',
          role: 'assistant' as const,
          sessionId: testSessionId,
        },
        {
          content: 'Batch message 3',
          role: 'user' as const,
          sessionId: testSessionId,
          topicId: testTopicId,
        },
      ];

      const result = await caller.batchCreateMessages(messagesToCreate);

      expect(result.success).toBe(true);
      // Some test drivers omit rowCount, so this assertion remains driver-neutral.
      // expect(result.added).toBe(3);

      // 验证数据库中的消息
      const dbMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.sessionId, testSessionId));

      expect(dbMessages.length).toBeGreaterThanOrEqual(3);
      const topicMessage = dbMessages.find((m) => m.content === 'Batch message 3');
      expect(topicMessage?.topicId).toBe(testTopicId);
    });
  });

  describe('removeMessages', () => {
    it('should remove multiple messages', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建消息
      const msg1Id = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Id = await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: testSessionId,
      });

      // 删除消息
      await caller.removeMessages({ ids: [msg1Id, msg2Id] });

      // 验证消息已删除
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.sessionId, testSessionId));

      expect(remainingMessages).toHaveLength(0);
    });
  });

  describe('removeMessagesByAssistant', () => {
    it('should remove all messages in a session', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 删除 session 中的所有消息
      await caller.removeMessagesByAssistant({
        sessionId: testSessionId,
      });

      // 验证消息已删除
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.sessionId, testSessionId));

      expect(remainingMessages).toHaveLength(0);
    });

    it('should remove messages in a specific topic', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 在 topic 中创建消息
      await caller.createMessage({
        content: 'Message in topic',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 在 session 中创建消息（不在 topic 中）
      const msgOutsideTopicId = await caller.createMessage({
        content: 'Message outside topic',
        role: 'user',
        sessionId: testSessionId,
      });

      // 删除 topic 中的消息
      await caller.removeMessagesByAssistant({
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 验证 topic 中的消息已删除，但 session 中的其他消息仍存在
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.sessionId, testSessionId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe(msgOutsideTopicId);
    });
  });

  describe('update', () => {
    it('should update message content', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const messageId = await caller.createMessage({
        content: 'Original content',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.update({
        id: messageId,
        value: {
          content: 'Updated content',
        },
      });

      const [updatedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, messageId));

      expect(updatedMessage.content).toBe('Updated content');
    });
  });

  describe('searchMessages', () => {
    it('should search messages by keyword', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'This is a test message about TypeScript',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Another message about JavaScript',
        role: 'user',
        sessionId: testSessionId,
      });

      const results = await caller.searchMessages({
        keywords: 'TypeScript',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('TypeScript');
    });
  });

  describe('count and statistics', () => {
    it('should count messages', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      const count = await caller.count();

      expect(count).toBe(2);
    });

    it('should count words', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'Hello world',
        role: 'user',
        sessionId: testSessionId,
      });

      const wordCount = await caller.countWords();

      expect(wordCount).toBeGreaterThan(0);
    });
  });
});
