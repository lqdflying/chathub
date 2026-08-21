import { DBMessageItem } from '@lobechat/types';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../models/__tests__/_util';
import {
  agents,
  agentsToSessions,
  chatGroups,
  chatGroupsAgents,
  chunks,
  embeddings,
  fileChunks,
  files,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messageTTS,
  messageTranslates,
  messages,
  messagesFiles,
  sessionGroups,
  sessions,
  threads,
  topics,
  userInstalledPlugins,
  userSettings,
  users,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { MessageModel } from '../message';
import { codeEmbedding } from './fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-db';
const messageModel = new MessageModel(serverDB, userId);
const embeddingsId = uuid();

beforeEach(async () => {
  // 在每个测试用例之前，清空表
  await serverDB.transaction(async (trx) => {
    await trx.delete(users);
    await trx.insert(users).values([{ id: userId }, { id: '456' }]);

    await trx.insert(sessions).values([
      // { id: 'session1', userId },
      // { id: 'session2', userId },
      { id: '1', userId },
    ]);
    await trx.insert(files).values({
      id: 'f1',
      userId: userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });

    await trx.insert(embeddings).values({
      id: embeddingsId,
      embeddings: codeEmbedding,
      userId,
    });
  });
});

afterEach(async () => {
  // 在每个测试用例之后，清空表
  await serverDB.delete(users);
});

describe('MessageModel', () => {
  describe('query', () => {
    it('should query messages by user ID', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1', createdAt: new Date('2023-01-01') },
        { id: '2', userId, role: 'user', content: 'message 2', createdAt: new Date('2023-02-01') },
        {
          id: '3',
          userId: '456',
          role: 'user',
          content: 'message 3',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      // 调用 query 方法
      const result = await messageModel.query();

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should return empty messages if not match the user ID', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId: '456', role: 'user', content: '1', createdAt: new Date('2023-01-01') },
        { id: '2', userId: '456', role: 'user', content: '2', createdAt: new Date('2023-02-01') },
        { id: '3', userId: '456', role: 'user', content: '3', createdAt: new Date('2023-03-01') },
      ]);

      // 调用 query 方法
      const result = await messageModel.query();

      // 断言结果
      expect(result).toHaveLength(0);
    });

    it('should query messages with pagination', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1', createdAt: new Date('2023-01-01') },
        { id: '2', userId, role: 'user', content: 'message 2', createdAt: new Date('2023-02-01') },
        { id: '3', userId, role: 'user', content: 'message 3', createdAt: new Date('2023-03-01') },
      ]);

      // 测试分页
      const result1 = await messageModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      const result2 = await messageModel.query({ current: 1, pageSize: 1 });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('2');
    });

    it('should preserve tied timestamp order across repeated paginated reads', async () => {
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      await messageModel.batchCreate([
        {
          id: 'child-a',
          parentId: 'parent-z',
          role: 'assistant',
          content: 'child',
          createdAt: tiedCreatedAt,
        },
        { id: 'parent-z', role: 'user', content: 'parent', createdAt: tiedCreatedAt },
      ]);

      const readPages = async () => {
        const firstPage = await messageModel.query({ current: 0, pageSize: 2 });
        const secondPage = await messageModel.query({ current: 1, pageSize: 2 });

        return [...firstPage, ...secondPage].map((message) => message.id);
      };

      await expect(readPages()).resolves.toEqual(['parent-z', 'child-a']);
      await expect(readPages()).resolves.toEqual(['parent-z', 'child-a']);
    });

    it('should filter messages by sessionId', async () => {
      // 创建测试数据
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          sessionId: 'session1',
          content: 'message 1',
          createdAt: new Date('2022-02-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          sessionId: 'session1',
          content: 'message 2',
          createdAt: new Date('2023-02-02'),
        },
        { id: '3', userId, role: 'user', sessionId: 'session2', content: 'message 3' },
      ]);

      // 测试根据 sessionId 过滤
      const result = await messageModel.query({ sessionId: 'session1' });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should filter messages by topicId', async () => {
      // 创建测试数据
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);
      const topicId = 'topic1';
      await serverDB.insert(topics).values([
        { id: topicId, sessionId, userId },
        { id: 'topic2', sessionId, userId },
      ]);

      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', topicId, content: '1', createdAt: new Date('2022-04-01') },
        { id: '2', userId, role: 'user', topicId, content: '2', createdAt: new Date('2023-02-01') },
        { id: '3', userId, role: 'user', topicId: 'topic2', content: 'message 3' },
      ]);

      // 测试根据 topicId 过滤
      const result = await messageModel.query({ topicId });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should include named-session topic rows when omitSessionFilter is set', async () => {
      const sessionId = 'session-named';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);
      const topicId = 'topic-named';
      await serverDB.insert(topics).values([{ id: topicId, sessionId, userId }]);
      await serverDB.insert(messages).values([
        {
          id: 'named-1',
          userId,
          role: 'user',
          sessionId,
          topicId,
          content: 'named session message',
        },
      ]);

      await expect(messageModel.query({ topicId })).resolves.toHaveLength(0);
      const result = await messageModel.query({ omitSessionFilter: true, topicId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('named-1');
    });

    it('should filter messages by groupId and expose group metadata', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'group-1', userId, title: 'Group 1' },
          { id: 'group-2', userId, title: 'Group 2' },
        ]);

        await trx.insert(agents).values([
          { id: 'agent-group', userId, title: 'Agent Group' },
          { id: 'agent-other', userId, title: 'Agent Other' },
        ]);

        await trx.insert(messages).values([
          {
            id: 'group-message',
            userId,
            role: 'assistant',
            content: 'group message',
            groupId: 'group-1',
            agentId: 'agent-group',
            targetId: 'user',
            createdAt: new Date('2024-01-01'),
          },
          {
            id: 'other-message',
            userId,
            role: 'assistant',
            content: 'other group message',
            groupId: 'group-2',
            agentId: 'agent-other',
            targetId: 'user',
            createdAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await messageModel.query({ groupId: 'group-1' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('group-message');
      expect(result[0].groupId).toBe('group-1');
      expect(result[0].agentId).toBe('agent-group');
      expect(result[0].targetId).toBe('user');
    });

    it('should query messages with join', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          {
            id: '1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: '2',
            userId,
            role: 'user',
            content: 'message 2',
            createdAt: new Date('2023-02-01'),
          },
          {
            id: '3',
            userId: '456',
            role: 'user',
            content: 'message 3',
            createdAt: new Date('2023-03-01'),
          },
        ]);
        await trx.insert(files).values([
          { id: 'f-0', url: 'abc', name: 'file-1', userId, fileType: 'image/png', size: 1000 },
          { id: 'f-1', url: 'abc', name: 'file-1', userId, fileType: 'image/png', size: 100 },
          { id: 'f-3', url: 'abc', name: 'file-3', userId, fileType: 'image/png', size: 400 },
        ]);
        await trx.insert(messageTTS).values([
          { id: '1', userId },
          { id: '2', voice: 'a', fileId: 'f-1', contentMd5: 'abc', userId },
        ]);

        await trx.insert(messagesFiles).values([
          { fileId: 'f-0', messageId: '1', userId },
          { fileId: 'f-3', messageId: '1', userId },
        ]);
      });

      const domain = 'http://abc.com';
      // 调用 query 方法
      const result = await messageModel.query(
        {},
        { postProcessUrl: async (path) => `${domain}/${path}` },
      );

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[0].imageList).toEqual([
        { alt: 'file-1', id: 'f-0', url: `${domain}/abc` },
        { alt: 'file-3', id: 'f-3', url: `${domain}/abc` },
      ]);

      expect(result[1].id).toBe('2');
      expect(result[1].imageList).toEqual([]);
    });

    it('should include translate, tts and other extra fields in query result', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          {
            id: '1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-01'),
          },
        ]);
        await trx
          .insert(messageTranslates)
          .values([{ id: '1', content: 'translated', from: 'en', to: 'zh', userId }]);
        await trx
          .insert(messageTTS)
          .values([{ id: '1', voice: 'voice1', fileId: 'f1', contentMd5: 'md5', userId }]);
      });

      // 调用 query 方法
      const result = await messageModel.query();

      // 断言结果
      expect(result[0].extra!.translate).toEqual({ content: 'translated', from: 'en', to: 'zh' });
      expect(result[0].extra!.tts).toEqual({
        contentMd5: 'md5',
        file: 'f1',
        voice: 'voice1',
      });
    });

    it('should handle edge cases of pagination parameters', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId, role: 'user', content: 'message 3' },
      ]);

      // 测试 current 和 pageSize 的边界情况
      const result1 = await messageModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      const result2 = await messageModel.query({ current: 1, pageSize: 2 });
      expect(result2).toHaveLength(1);

      const result3 = await messageModel.query({ current: 2, pageSize: 2 });
      expect(result3).toHaveLength(0);
    });

    describe('query with messageQueries', () => {
      it('should include ragQuery, ragQueryId and ragRawQuery in query results', async () => {
        // 创建测试数据
        const messageId = 'msg-with-query';
        const queryId = uuid();

        await serverDB.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'test message',
        });

        await serverDB.insert(messageQueries).values({
          id: queryId,
          messageId,
          userQuery: 'original query',
          rewriteQuery: 'rewritten query',
          userId,
        });

        // 调用 query 方法
        const result = await messageModel.query();

        // 断言结果
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(messageId);
        expect(result[0].ragQueryId).toBe(queryId);
        expect(result[0].ragQuery).toBe('rewritten query');
        expect(result[0].ragRawQuery).toBe('original query');
      });

      it.skip('should handle multiple message queries for the same message', async () => {
        // 创建测试数据
        const messageId = 'msg-multi-query';
        const queryId1 = uuid();
        const queryId2 = uuid();

        await serverDB.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'test message',
        });

        // 创建两个查询，但查询结果应该只包含一个（最新的）
        await serverDB.insert(messageQueries).values([
          {
            id: queryId1,
            messageId,
            userQuery: 'original query 1',
            rewriteQuery: 'rewritten query 1',
            userId,
          },
          {
            id: queryId2,
            messageId,
            userQuery: 'original query 2',
            rewriteQuery: 'rewritten query 2',
            userId,
          },
        ]);

        // 调用 query 方法
        const result = await messageModel.query();

        // 断言结果 - 应该只包含最新的查询
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(messageId);
        expect(result[0].ragQueryId).toBe(queryId2);
        expect(result[0].ragQuery).toBe('rewritten query 2');
        expect(result[0].ragRawQuery).toBe('original query 2');
      });
    });

    it('should handle complex query with multiple joins and file chunks', async () => {
      await serverDB.transaction(async (trx) => {
        const chunk1Id = uuid();
        const query1Id = uuid();
        // 创建基础消息
        await trx.insert(messages).values({
          id: 'msg1',
          userId,
          role: 'user',
          content: 'test message',
          createdAt: new Date('2023-01-01'),
        });

        // 创建文件
        await trx.insert(files).values([
          {
            id: 'file1',
            userId,
            name: 'test.txt',
            url: 'test-url',
            fileType: 'text/plain',
            size: 100,
          },
        ]);

        // 创建文件块
        await trx.insert(chunks).values({
          id: chunk1Id,
          text: 'chunk content',
        });

        // 关联消息和文件
        await trx.insert(messagesFiles).values({
          messageId: 'msg1',
          userId,
          fileId: 'file1',
        });

        // 创建文件块关联
        await trx.insert(fileChunks).values({
          fileId: 'file1',
          userId,
          chunkId: chunk1Id,
        });

        // 创建消息查询
        await trx.insert(messageQueries).values({
          id: query1Id,
          messageId: 'msg1',
          userId,
          userQuery: 'original query',
          rewriteQuery: 'rewritten query',
        });

        // 创建消息查询块关联
        await trx.insert(messageQueryChunks).values({
          messageId: 'msg1',
          queryId: query1Id,
          chunkId: chunk1Id,
          similarity: '0.95',
          userId,
        });
      });

      const result = await messageModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].chunksList).toHaveLength(1);
      expect(result[0].chunksList![0]).toMatchObject({
        text: 'chunk content',
        similarity: 0.95,
      });
    });

    it('should return empty arrays for files and chunks if none exist', async () => {
      await serverDB.insert(messages).values({
        id: 'msg1',
        userId,
        role: 'user',
        content: 'test message',
      });

      const result = await messageModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].fileList).toEqual([]);
      expect(result[0].imageList).toEqual([]);
      expect(result[0].chunksList).toEqual([]);
    });
  });

  describe('queryAll', () => {
    it('should return all messages belonging to the user in ascending order', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: new Date('2023-02-01'),
        },
        {
          id: '3',
          userId: '456',
          role: 'user',
          content: 'message 3',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      // 调用 queryAll 方法
      const result = await messageModel.queryAll();

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should use internal message order to stabilize tied timestamps', async () => {
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      await messageModel.batchCreate([
        {
          id: 'child-a',
          parentId: 'parent-z',
          role: 'assistant',
          content: 'child',
          createdAt: tiedCreatedAt,
        },
        { id: 'parent-z', role: 'user', content: 'parent', createdAt: tiedCreatedAt },
      ]);

      const firstRead = await messageModel.queryAll();
      const secondRead = await messageModel.queryAll();

      expect(firstRead.map((message) => message.id)).toEqual(['parent-z', 'child-a']);
      expect(secondRead.map((message) => message.id)).toEqual(['parent-z', 'child-a']);
      expect(firstRead.every((message) => !('messageOrder' in message))).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find message by ID', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId: '456', role: 'user', content: 'message 2' },
      ]);

      // 调用 findById 方法
      const result = await messageModel.findById('1');

      // 断言结果
      expect(result?.id).toBe('1');
      expect(result?.content).toBe('message 1');
    });

    it('should return undefined if message does not belong to user', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId: '456', role: 'user', content: 'message 1' }]);

      // 调用 findById 方法
      const result = await messageModel.findById('1');

      // 断言结果
      expect(result).toBeUndefined();
    });
  });

  describe('queryBySessionId', () => {
    it('should query messages by sessionId', async () => {
      // 创建测试数据
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          sessionId,
          content: 'message 1',
          createdAt: new Date('2022-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          sessionId,
          content: 'message 2',
          createdAt: new Date('2023-02-01'),
        },
        { id: '3', userId, role: 'user', sessionId: 'session2', content: 'message 3' },
      ]);

      // 调用 queryBySessionId 方法
      const result = await messageModel.queryBySessionId(sessionId);

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should preserve causal order for tied timestamps', async () => {
      const sessionId = 'session1';
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      await serverDB.insert(sessions).values({ id: sessionId, userId });
      await messageModel.batchCreate([
        {
          id: 'child-a',
          parentId: 'parent-z',
          role: 'assistant',
          sessionId,
          content: 'child',
          createdAt: tiedCreatedAt,
        },
        {
          id: 'parent-z',
          role: 'user',
          sessionId,
          content: 'parent',
          createdAt: tiedCreatedAt,
        },
      ]);

      const result = await messageModel.queryBySessionId(sessionId);

      expect(result.map((message) => message.id)).toEqual(['parent-z', 'child-a']);
      expect(result.every((message) => !('messageOrder' in message))).toBe(true);
    });
  });

  describe('queryByKeyWord', () => {
    it('should query messages by keyword', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'apple', createdAt: new Date('2022-02-01') },
        { id: '2', userId, role: 'user', content: 'banana' },
        { id: '3', userId, role: 'user', content: 'pear' },
        { id: '4', userId, role: 'user', content: 'apple pie', createdAt: new Date('2024-02-01') },
      ]);

      // 测试查询包含特定关键字的消息
      const result = await messageModel.queryByKeyword('apple');

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4');
      expect(result[1].id).toBe('1');
    });

    it('should use descending internal order for tied timestamps', async () => {
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      await messageModel.batchCreate([
        {
          id: 'child-a',
          parentId: 'parent-z',
          role: 'assistant',
          content: 'apple child',
          createdAt: tiedCreatedAt,
        },
        { id: 'parent-z', role: 'user', content: 'apple parent', createdAt: tiedCreatedAt },
      ]);

      const result = await messageModel.queryByKeyword('apple');

      expect(result.map((message) => message.id)).toEqual(['child-a', 'parent-z']);
      expect(result.every((message) => !('messageOrder' in message))).toBe(true);
    });

    it('should return empty array when keyword is empty', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'apple' },
        { id: '2', userId, role: 'user', content: 'banana' },
        { id: '3', userId, role: 'user', content: 'pear' },
        { id: '4', userId, role: 'user', content: 'apple pie' },
      ]);

      // 测试当关键字为空时返回空数组
      const result = await messageModel.queryByKeyword('');

      // 断言结果
      expect(result).toHaveLength(0);
    });
  });

  describe('createMessage', () => {
    it('should create a new message', async () => {
      // 调用 createMessage 方法
      await messageModel.create({ role: 'user', content: 'new message', sessionId: '1' });

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('new message');
    });

    it('should touch the associated topic activity when creating a message', async () => {
      const previousActivityAt = new Date('2024-01-01T00:00:00.000Z');
      await serverDB.insert(topics).values({
        id: 'message-activity-topic',
        lastActivityAt: previousActivityAt,
        userId,
      });

      await messageModel.create({
        content: 'new topic message',
        role: 'user',
        topicId: 'message-activity-topic',
      });

      const [updatedTopic] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, 'message-activity-topic'));

      expect(updatedTopic.lastActivityAt.getTime()).toBeGreaterThan(previousActivityAt.getTime());
    });

    it('should create a message', async () => {
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);

      const result = await messageModel.create({
        content: 'message 1',
        role: 'user',
        sessionId: 'session1',
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('user');
      expect(result.sessionId).toBe('session1');
      expect(result.userId).toBe(userId);
    });

    it('should generate message ID automatically', async () => {
      // 调用 createMessage 方法
      await messageModel.create({
        role: 'user',
        content: 'new message',
        sessionId: '1',
      });

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result[0].id).toBeDefined();
      expect(result[0].id).toHaveLength(18);
    });

    it('should create a tool message and insert into messagePlugins table', async () => {
      // 调用 create 方法
      const result = await messageModel.create({
        content: 'message 1',
        role: 'tool',
        sessionId: '1',
        tool_call_id: 'tool1',
        plugin: {
          apiName: 'api1',
          arguments: 'arg1',
          identifier: 'plugin1',
          type: 'default',
        },
      });

      // 断言结果
      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('plugin1');
    });

    it('should create tool message ', async () => {
      // 调用 create 方法
      const state = {
        query: 'Composio',
        answers: [],
        results: [
          {
            url: 'https://www.composio.dev/',
            score: 16,
            title: 'Composio - Connect 90+ tools to your AI agents',
            engine: 'bing',
            content:
              'Faster DevelopmentHigher ReliabilityBetter Integrations. Get Started Now. Our platform lets you ditch the specs and seamlessly integrate any tool you need in less than 5 mins.',
            engines: ['bing', 'qwant', 'brave', 'duckduckgo'],
            category: 'general',
            template: 'default.html',
            positions: [1, 1, 1, 1],
            thumbnail: '',
            parsed_url: ['https', 'www.composio.dev', '/', '', '', ''],
            publishedDate: null,
          },
          {
            url: 'https://www.composio.co/',
            score: 10.75,
            title: 'Composio',
            engine: 'bing',
            content:
              'Composio was created to help streamline the entire book creation process! Writing. Take time out to write / Make a schedule to write consistently. We have writing software that optimizes your books for printing or ebook format. Figure out what you want to write. Collaborate and write with others. Professional editing is a necessity.',
            engines: ['qwant', 'duckduckgo', 'google', 'bing', 'brave'],
            category: 'general',
            template: 'default.html',
            positions: [5, 2, 1, 5, 4],
            thumbnail: null,
            parsed_url: ['https', 'www.composio.co', '/', '', '', ''],
            publishedDate: null,
          },
        ],
        unresponsive_engines: [],
      };
      const result = await messageModel.create({
        content: '[{}]',
        plugin: {
          apiName: 'searchWithSearXNG',
          arguments: '{\n  "query": "Composio"\n}',
          identifier: 'lobe-web-browsing',
          type: 'builtin',
        },
        pluginState: state,
        role: 'tool',
        tool_call_id: 'tool_call_ymxXC2J0',
        sessionId: '1',
      });

      // 断言结果
      expect(result.id).toBeDefined();
      expect(result.content).toBe('[{}]');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('lobe-web-browsing');
      expect(pluginResult[0].state!).toMatchObject(state);
    });

    describe('create with advanced parameters', () => {
      it('should create a message with custom ID', async () => {
        const customId = 'custom-msg-id';

        const result = await messageModel.create(
          {
            role: 'user',
            content: 'message with custom ID',
            sessionId: '1',
          },
          customId,
        );

        expect(result.id).toBe(customId);

        // 验证数据库中的记录
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, customId));
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0].id).toBe(customId);
      });

      it.skip('should create a message with file chunks and RAG query ID', async () => {
        // 创建测试数据
        const chunkId1 = uuid();
        const chunkId2 = uuid();
        const ragQueryId = uuid();

        await serverDB.insert(chunks).values([
          { id: chunkId1, text: 'chunk text 1' },
          { id: chunkId2, text: 'chunk text 2' },
        ]);

        // 调用 create 方法
        const result = await messageModel.create({
          role: 'assistant',
          content: 'message with file chunks',
          fileChunks: [
            { id: chunkId1, similarity: 0.95 },
            { id: chunkId2, similarity: 0.85 },
          ],
          ragQueryId,
          sessionId: '1',
        });

        // 验证消息创建成功
        expect(result.id).toBeDefined();

        // 验证消息查询块关联创建成功
        const queryChunks = await serverDB
          .select()
          .from(messageQueryChunks)
          .where(eq(messageQueryChunks.messageId, result.id));

        expect(queryChunks).toHaveLength(2);
        expect(queryChunks[0].chunkId).toBe(chunkId1);
        expect(queryChunks[0].queryId).toBe(ragQueryId);
        expect(queryChunks[0].similarity).toBe('0.95');
        expect(queryChunks[1].chunkId).toBe(chunkId2);
        expect(queryChunks[1].similarity).toBe('0.85');
      });

      it('should create a message with files', async () => {
        // 创建测试数据
        await serverDB.insert(files).values([
          {
            id: 'file1',
            name: 'file1.txt',
            fileType: 'text/plain',
            size: 100,
            url: 'url1',
            userId,
          },
          {
            id: 'file2',
            name: 'file2.jpg',
            fileType: 'image/jpeg',
            size: 200,
            url: 'url2',
            userId,
          },
        ]);

        // 调用 create 方法
        const result = await messageModel.create({
          role: 'user',
          content: 'message with files',
          files: ['file1', 'file2'],
          sessionId: '1',
        });

        // 验证消息创建成功
        expect(result.id).toBeDefined();

        // 验证消息文件关联创建成功
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, result.id));

        expect(messageFiles).toHaveLength(2);
        expect(messageFiles[0].fileId).toBe('file1');
        expect(messageFiles[1].fileId).toBe('file2');
      });

      it('should create a message with custom timestamps', async () => {
        const customCreatedAt = '2022-05-15T10:30:00Z';
        const customUpdatedAt = '2022-05-16T11:45:00Z';

        const result = await messageModel.create({
          role: 'user',
          content: 'message with custom timestamps',
          createdAt: customCreatedAt as any,
          updatedAt: customUpdatedAt as any,
          sessionId: '1',
        });

        // 验证数据库中的记录
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, result.id));

        // 日期比较需要考虑时区和格式化问题，所以使用 toISOString 进行比较
        expect(new Date(dbResult[0].createdAt!).toISOString()).toBe(
          new Date(customCreatedAt).toISOString(),
        );
        expect(new Date(dbResult[0].updatedAt!).toISOString()).toBe(
          new Date(customUpdatedAt).toISOString(),
        );
      });
    });
  });

  describe('batchCreateMessages', () => {
    it('should assign unique parent-first order without exposing it', async () => {
      // 准备测试数据
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      const newMessages = [
        {
          id: 'child-a',
          parentId: 'parent-z',
          role: 'assistant',
          content: 'child',
          createdAt: tiedCreatedAt,
        },
        { id: 'parent-z', role: 'user', content: 'parent', createdAt: tiedCreatedAt },
      ] as DBMessageItem[];

      // 调用 batchCreateMessages 方法
      await messageModel.batchCreate(newMessages);

      // 断言结果
      const internalRows = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(messages.messageOrder);
      expect(internalRows.map(({ id }) => id)).toEqual(['parent-z', 'child-a']);
      expect(new Set(internalRows.map(({ messageOrder }) => messageOrder)).size).toBe(2);

      const publicRows = await messageModel.queryAll();
      expect(publicRows.every((message) => !('messageOrder' in message))).toBe(true);
    });

    it('should preserve source order between independent turns with tied timestamps', async () => {
      const tiedCreatedAt = new Date('2024-01-01T00:00:00.000Z');
      await messageModel.batchCreate([
        {
          content: 'first turn',
          createdAt: tiedCreatedAt,
          id: 'turn-z',
          role: 'user',
        },
        {
          content: 'first reply',
          createdAt: tiedCreatedAt,
          id: 'reply-z',
          parentId: 'turn-z',
          role: 'assistant',
        },
        {
          content: 'second turn',
          createdAt: tiedCreatedAt,
          id: 'turn-a',
          role: 'user',
        },
        {
          content: 'second reply',
          createdAt: tiedCreatedAt,
          id: 'reply-a',
          parentId: 'turn-a',
          role: 'assistant',
        },
      ] as DBMessageItem[]);

      const internalRows = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(messages.messageOrder);

      expect(internalRows.map(({ id }) => id)).toEqual(['turn-z', 'reply-z', 'turn-a', 'reply-a']);
    });
  });

  describe('createNewMessage', () => {
    it('should create message and return id with messages list', async () => {
      // 调用 createNewMessage 方法
      const result = await messageModel.createNewMessage({
        role: 'user',
        content: 'test message',
        sessionId: '1',
      });

      // 断言返回结构
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('messages');
      expect(result.id).toBeDefined();
      expect(result.messages).toBeInstanceOf(Array);
    });

    it('should return newly created message in messages list', async () => {
      const content = 'new test message ' + Date.now();

      const result = await messageModel.createNewMessage({
        role: 'user',
        content,
        sessionId: '1',
      });

      // 验证新创建的消息在列表中
      const createdMessage = result.messages.find((m) => m.id === result.id);
      expect(createdMessage).toBeDefined();
      expect(createdMessage?.content).toBe(content);
      expect(createdMessage?.role).toBe('user');
    });

    it('should return all messages for the session', async () => {
      // 创建多条消息
      await messageModel.create({ role: 'user', content: 'message 1', sessionId: '1' });
      await messageModel.create({ role: 'assistant', content: 'message 2', sessionId: '1' });

      // 创建第三条消息并获取完整列表
      const result = await messageModel.createNewMessage({
        role: 'user',
        content: 'message 3',
        sessionId: '1',
      });

      // 验证返回了所有消息
      expect(result.messages.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter messages by topicId if provided', async () => {
      const topicId = 'topic-1';
      await serverDB.insert(topics).values({ id: topicId, sessionId: '1', userId });

      // 创建不同 topic 的消息
      await messageModel.create({ role: 'user', content: 'topic 1 msg', sessionId: '1', topicId });
      await messageModel.create({ role: 'user', content: 'no topic msg', sessionId: '1' });

      // 创建新消息并指定 topicId
      const result = await messageModel.createNewMessage({
        role: 'user',
        content: 'new topic msg',
        sessionId: '1',
        topicId,
      });

      // 验证只返回该 topic 的消息
      expect(result.messages.every((m) => m.topicId === topicId || m.topicId === undefined)).toBe(
        true,
      );
      expect(result.messages.find((m) => m.content === 'no topic msg')).toBeUndefined();
    });
  });

  describe('updateMessage', () => {
    it('should update message content', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 调用 updateMessage 方法
      await messageModel.update('1', { content: 'updated message' });

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result[0].content).toBe('updated message');
    });

    it('should only update messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId: '456', role: 'user', content: 'message 1' }]);

      // 调用 updateMessage 方法
      await messageModel.update('1', { content: 'updated message' });

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result[0].content).toBe('message 1');
    });

    it('should update message tools', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          tools: [
            {
              id: 'call_Z8UU8LedZcoJHFGkfqYecjmT',
              type: 'builtin',
              apiName: 'searchWithSearXNG',
              arguments:
                '{"query":"杭州洪水 2023","searchEngines":["google","bing","baidu","duckduckgo","brave"]}',
              identifier: 'lobe-web-browsing',
            },
          ],
        },
      ]);

      // 调用 updateMessage 方法
      await messageModel.update('1', {
        tools: [
          {
            id: 'call_Z8UU8LedZcoJHFGkfqYecjmT',
            type: 'builtin',
            apiName: 'searchWithSearXNG',
            arguments: '{"query":"2024 杭州暴雨","searchEngines":["duckduckgo","google","brave"]}',
            identifier: 'lobe-web-browsing',
          },
        ],
      });

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect((result[0].tools as any)[0].arguments).toBe(
        '{"query":"2024 杭州暴雨","searchEngines":["duckduckgo","google","brave"]}',
      );
    });

    describe('update with imageList', () => {
      it('should update a message and add image files', async () => {
        // 创建测试数据
        await serverDB.insert(messages).values({
          id: 'msg-to-update',
          userId,
          role: 'user',
          content: 'original content',
        });

        await serverDB.insert(files).values([
          {
            id: 'img1',
            name: 'image1.jpg',
            fileType: 'image/jpeg',
            size: 100,
            url: 'url1',
            userId,
          },
          { id: 'img2', name: 'image2.png', fileType: 'image/png', size: 200, url: 'url2', userId },
        ]);

        // 调用 update 方法
        await messageModel.update('msg-to-update', {
          content: 'updated content',
          imageList: [
            { id: 'img1', alt: 'image 1', url: 'url1' },
            { id: 'img2', alt: 'image 2', url: 'url2' },
          ],
        });

        // 验证消息更新成功
        const updatedMessage = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, 'msg-to-update'));

        expect(updatedMessage[0].content).toBe('updated content');

        // 验证消息文件关联创建成功
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, 'msg-to-update'));

        expect(messageFiles).toHaveLength(2);
        expect(messageFiles[0].fileId).toBe('img1');
        expect(messageFiles[1].fileId).toBe('img2');
      });

      it('should allow an identical image update to be retried', async () => {
        await serverDB.insert(messages).values({
          id: 'msg-image-retry',
          userId,
          role: 'assistant',
          content: 'original content',
        });
        await serverDB.insert(files).values({
          id: 'retry-image',
          name: 'retry-image.png',
          fileType: 'image/png',
          size: 200,
          url: 'retry-url',
          userId,
        });
        const update = {
          content: 'final content',
          imageList: [{ id: 'retry-image', alt: 'retry image', url: 'retry-url' }],
          observationId: 'observation-id',
          traceId: 'trace-id',
        };

        await messageModel.update('msg-image-retry', update);
        await messageModel.update('msg-image-retry', update);

        const [updatedMessage] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, 'msg-image-retry'));
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, 'msg-image-retry'));

        expect(updatedMessage).toMatchObject({
          content: 'final content',
          observationId: 'observation-id',
          traceId: 'trace-id',
        });
        expect(messageFiles).toHaveLength(1);
        expect(messageFiles[0].fileId).toBe('retry-image');
      });

      it('should handle empty imageList', async () => {
        // 创建测试数据
        await serverDB.insert(messages).values({
          id: 'msg-no-images',
          userId,
          role: 'user',
          content: 'original content',
        });

        // 调用 update 方法，不提供 imageList
        await messageModel.update('msg-no-images', {
          content: 'updated content',
        });

        // 验证消息更新成功
        const updatedMessage = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, 'msg-no-images'));

        expect(updatedMessage[0].content).toBe('updated content');

        // 验证没有创建消息文件关联
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, 'msg-no-images'));

        expect(messageFiles).toHaveLength(0);
      });

      it('should update multiple fields at once', async () => {
        // 创建测试数据
        await serverDB.insert(messages).values({
          id: 'msg-multi-update',
          userId,
          role: 'user',
          content: 'original content',
          model: 'gpt-3.5',
        });

        // 调用 update 方法，更新多个字段
        await messageModel.update('msg-multi-update', {
          content: 'updated content',
          role: 'assistant',
          model: 'gpt-4',
          metadata: { tps: 1 },
        });

        // 验证消息更新成功
        const updatedMessage = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, 'msg-multi-update'));

        expect(updatedMessage[0].content).toBe('updated content');
        expect(updatedMessage[0].role).toBe('assistant');
        expect(updatedMessage[0].model).toBe('gpt-4');
        expect(updatedMessage[0].metadata).toEqual({ tps: 1 });
      });
    });
  });

  describe('deleteMessage', () => {
    it('should delete a message', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);
    });

    it('should delete a message with tool calls', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          { id: '1', userId, role: 'user', content: 'message 1', tools: [{ id: 'tool1' }] },
          { id: '2', userId, role: 'tool', content: 'message 1' },
        ]);
        await trx
          .insert(messagePlugins)
          .values([{ id: '2', toolCallId: 'tool1', identifier: 'plugin-1', userId }]);
      });

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);

      const result2 = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, '2'));

      expect(result2).toHaveLength(0);
    });

    it('should only delete messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId: '456', role: 'user', content: 'message 1' }]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteMessages', () => {
    it('should delete 2 messages', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
      ]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessages(['1', '2']);

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);
      const result2 = await serverDB.select().from(messages).where(eq(messages.id, '2'));
      expect(result2).toHaveLength(0);
    });

    it('should only delete messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId: '456', role: 'user', content: 'message 1' },
        { id: '2', userId: '456', role: 'user', content: 'message 1' },
      ]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessages(['1', '2']);

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(1);
    });
  });

  describe('rewindMessages', () => {
    it('deletes recursively dependent threads in the same transaction', async () => {
      await serverDB.insert(topics).values({ id: 'rewind-topic', sessionId: '1', userId });
      await serverDB.insert(messages).values([
        { id: 'user-anchor', role: 'user', topicId: 'rewind-topic', userId },
        { id: 'tail-message', role: 'assistant', topicId: 'rewind-topic', userId },
      ]);
      await serverDB.insert(threads).values({
        id: 'root-thread',
        sourceMessageId: 'tail-message',
        topicId: 'rewind-topic',
        type: 'continuation',
        userId,
      });
      await serverDB.insert(messages).values({
        id: 'root-thread-message',
        role: 'assistant',
        threadId: 'root-thread',
        topicId: 'rewind-topic',
        userId,
      });
      await serverDB.insert(threads).values([
        {
          id: 'child-thread',
          parentThreadId: 'root-thread',
          sourceMessageId: 'root-thread-message',
          topicId: 'rewind-topic',
          type: 'continuation',
          userId,
        },
        {
          id: 'retained-thread',
          sourceMessageId: 'user-anchor',
          topicId: 'rewind-topic',
          type: 'continuation',
          userId,
        },
      ]);
      await serverDB.insert(messages).values([
        {
          id: 'child-thread-message',
          role: 'assistant',
          threadId: 'child-thread',
          topicId: 'rewind-topic',
          userId,
        },
        {
          id: 'retained-thread-message',
          role: 'assistant',
          threadId: 'retained-thread',
          topicId: 'rewind-topic',
          userId,
        },
      ]);

      const result = await messageModel.rewindMessages(['tail-message']);

      expect(new Set(result.messageIds)).toEqual(
        new Set(['tail-message', 'root-thread-message', 'child-thread-message']),
      );
      expect(new Set(result.threadIds)).toEqual(new Set(['root-thread', 'child-thread']));
      expect((await serverDB.select().from(threads)).map(({ id }) => id)).toEqual([
        'retained-thread',
      ]);
      expect((await serverDB.select().from(messages)).map(({ id }) => id).sort()).toEqual(
        ['retained-thread-message', 'user-anchor'].sort(),
      );
    });
  });

  describe('deleteAllMessages', () => {
    it('should delete all messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: '456', role: 'user', content: 'message 3' },
      ]);

      // 调用 deleteAllMessages 方法
      await messageModel.deleteAllMessages();

      // 断言结果
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));

      expect(result).toHaveLength(0);

      const otherResult = await serverDB.select().from(messages).where(eq(messages.userId, '456'));

      expect(otherResult).toHaveLength(1);
    });
  });

  describe('deleteAllTopicsHistory', () => {
    it('should clear current-user conversation history while preserving configuration and other users', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction.insert(sessionGroups).values({
          id: 'history-session-group',
          name: 'Preserved session group',
          userId,
        });
        await transaction.insert(chatGroups).values({
          groupId: 'history-session-group',
          id: 'history-group',
          userId,
        });
        await transaction.insert(agents).values({
          id: 'history-agent',
          systemRole: 'Preserved assistant role',
          title: 'Preserved assistant',
          userId,
        });
        await transaction.insert(agentsToSessions).values({
          agentId: 'history-agent',
          sessionId: '1',
          userId,
        });
        await transaction.insert(chatGroupsAgents).values({
          agentId: 'history-agent',
          chatGroupId: 'history-group',
          role: 'moderator',
          userId,
        });
        await transaction.insert(userSettings).values({
          general: { generalInstruction: 'Preserved instruction' },
          id: userId,
        });
        await transaction.insert(userInstalledPlugins).values({
          identifier: 'preserved-plugin',
          type: 'customPlugin',
          userId,
        });
        await transaction.insert(topics).values({ id: 'history-topic', userId });
        await transaction.insert(messages).values([
          { id: 'topic-history-message', role: 'user', topicId: 'history-topic', userId },
          { id: 'default-history-message', role: 'user', sessionId: '1', userId },
          { id: 'group-history-message', role: 'assistant', groupId: 'history-group', userId },
          { id: 'other-user-message', role: 'user', userId: '456' },
        ]);
        await transaction.insert(messageGroups).values({
          id: 'history-message-group',
          topicId: 'history-topic',
          userId,
        });
      });

      const result = await messageModel.deleteAllTopicsHistory();

      expect(result).toEqual({ deletedMessageCount: 3, deletedTopicCount: 1 });
      expect(await serverDB.select().from(topics).where(eq(topics.userId, userId))).toHaveLength(0);
      expect(
        await serverDB.select().from(messages).where(eq(messages.userId, userId)),
      ).toHaveLength(0);
      expect(
        await serverDB.select().from(messageGroups).where(eq(messageGroups.userId, userId)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(messages).where(eq(messages.userId, '456'))).toHaveLength(
        1,
      );
      expect(
        await serverDB.select().from(sessions).where(eq(sessions.userId, userId)),
      ).toHaveLength(1);
      expect(
        await serverDB.select().from(sessionGroups).where(eq(sessionGroups.userId, userId)),
      ).toHaveLength(1);
      expect(await serverDB.select().from(files).where(eq(files.userId, userId))).toHaveLength(1);
      expect(
        await serverDB.select().from(embeddings).where(eq(embeddings.userId, userId)),
      ).toHaveLength(1);
      const preservedAgents = await serverDB.select().from(agents).where(eq(agents.userId, userId));
      expect(preservedAgents).toHaveLength(1);
      expect(preservedAgents[0]).toMatchObject({
        id: 'history-agent',
        systemRole: 'Preserved assistant role',
      });
      expect(
        await serverDB.select().from(agentsToSessions).where(eq(agentsToSessions.userId, userId)),
      ).toHaveLength(1);
      expect(
        await serverDB.select().from(chatGroups).where(eq(chatGroups.userId, userId)),
      ).toHaveLength(1);
      expect(
        await serverDB.select().from(chatGroupsAgents).where(eq(chatGroupsAgents.userId, userId)),
      ).toHaveLength(1);
      expect(
        await serverDB.select().from(userSettings).where(eq(userSettings.id, userId)),
      ).toHaveLength(1);
      expect(
        await serverDB
          .select()
          .from(userInstalledPlugins)
          .where(eq(userInstalledPlugins.userId, userId)),
      ).toHaveLength(1);
    });
  });

  describe('updatePluginState', () => {
    it('should update the state field in messagePlugins table', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({ id: '1', content: 'abc', role: 'user', userId });
      await serverDB.insert(messagePlugins).values([
        {
          id: '1',
          toolCallId: 'tool1',
          identifier: 'plugin1',
          state: { key1: 'value1' },
          userId,
        },
      ]);

      // 调用 updatePluginState 方法
      await messageModel.updatePluginState('1', { key2: 'value2' });

      // 断言结果
      const result = await serverDB.select().from(messagePlugins).where(eq(messagePlugins.id, '1'));

      expect(result[0].state).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should throw an error if plugin does not exist', async () => {
      // 调用 updatePluginState 方法
      await expect(messageModel.updatePluginState('1', { key: 'value' })).rejects.toThrowError(
        'Plugin not found',
      );
    });
  });

  describe('MCP result recovery', () => {
    beforeEach(async () => {
      await serverDB.insert(messages).values({
        content: '',
        id: 'mcp-tool-message',
        role: 'tool',
        userId,
      });
      await serverDB.insert(messagePlugins).values({
        id: 'mcp-tool-message',
        identifier: 'tavily',
        state: { existing: 'value' },
        toolCallId: 'tool-call-id',
        userId,
      });
    });

    it('persists and recovers only the matching invocation result', async () => {
      await expect(
        messageModel.beginMCPResultInvocation('mcp-tool-message', 'mi_12345678901234567890'),
      ).resolves.toBe(true);
      await expect(
        messageModel.persistMCPResult(
          'mcp-tool-message',
          'mi_12345678901234567890',
          '{"result":"persisted"}',
        ),
      ).resolves.toBe(true);

      await expect(
        messageModel.recoverMCPResult('mcp-tool-message', 'mi_12345678901234567890'),
      ).resolves.toEqual({ content: '{"result":"persisted"}' });
      await expect(
        messageModel.recoverMCPResult('mcp-tool-message', 'mi_00000000000000000000'),
      ).resolves.toBeUndefined();
      const plugin = await serverDB.query.messagePlugins.findFirst({
        where: eq(messagePlugins.id, 'mcp-tool-message'),
      });
      expect(plugin?.state).toMatchObject({ existing: 'value' });
    });

    it('does not let a second invocation steal a pending MCP result', async () => {
      await messageModel.beginMCPResultInvocation('mcp-tool-message', 'mi_11111111111111111111');

      await expect(
        messageModel.beginMCPResultInvocation('mcp-tool-message', 'mi_22222222222222222222'),
      ).resolves.toBe(false);

      await expect(
        messageModel.persistMCPResult(
          'mcp-tool-message',
          'mi_11111111111111111111',
          '{"result":"current"}',
        ),
      ).resolves.toBe(true);
      await expect(
        messageModel.recoverMCPResult('mcp-tool-message', 'mi_11111111111111111111'),
      ).resolves.toEqual({ content: '{"result":"current"}' });
    });
  });

  describe('updateMessagePlugin', () => {
    it('should update the state field in messagePlugins table', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({ id: '1', content: 'abc', role: 'user', userId });
      await serverDB.insert(messagePlugins).values([
        {
          id: '1',
          toolCallId: 'tool1',
          identifier: 'plugin1',
          state: { key1: 'value1' },
          userId,
        },
      ]);

      // 调用 updatePluginState 方法
      await messageModel.updateMessagePlugin('1', { identifier: 'plugin2' });

      // 断言结果
      const result = await serverDB.select().from(messagePlugins).where(eq(messagePlugins.id, '1'));

      expect(result[0].identifier).toEqual('plugin2');
    });

    it('should throw an error if plugin does not exist', async () => {
      // 调用 updatePluginState 方法
      await expect(messageModel.updatePluginState('1', { key: 'value' })).rejects.toThrowError(
        'Plugin not found',
      );
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata for an existing message', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({
        id: 'msg-with-metadata',
        userId,
        role: 'user',
        content: 'test message',
        metadata: { existingKey: 'existingValue' },
      });

      // 调用 updateMetadata 方法
      await messageModel.updateMetadata('msg-with-metadata', { newKey: 'newValue' });

      // 断言结果
      const result = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-with-metadata'));

      expect(result[0].metadata).toEqual({
        existingKey: 'existingValue',
        newKey: 'newValue',
      });
    });

    it('should merge new metadata with existing metadata using lodash merge behavior', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({
        id: 'msg-merge-metadata',
        userId,
        role: 'assistant',
        content: 'test message',
        metadata: {
          level1: {
            level2a: 'original',
            level2b: { level3: 'deep' },
          },
          array: [1, 2, 3],
        },
      });

      // 调用 updateMetadata 方法
      await messageModel.updateMetadata('msg-merge-metadata', {
        level1: {
          level2a: 'updated',
          level2c: 'new',
        },
        newTopLevel: 'value',
      });

      // 断言结果 - 应该使用 lodash merge 行为
      const result = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-merge-metadata'));

      expect(result[0].metadata).toEqual({
        level1: {
          level2a: 'updated',
          level2b: { level3: 'deep' },
          level2c: 'new',
        },
        array: [1, 2, 3],
        newTopLevel: 'value',
      });
    });

    it('should handle non-existent message IDs', async () => {
      // 调用 updateMetadata 方法，尝试更新不存在的消息
      const result = await messageModel.updateMetadata('non-existent-id', { key: 'value' });

      // 断言结果 - 应该返回 undefined
      expect(result).toBeUndefined();
    });

    it('should handle empty metadata updates', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({
        id: 'msg-empty-metadata',
        userId,
        role: 'user',
        content: 'test message',
        metadata: { originalKey: 'originalValue' },
      });

      // 调用 updateMetadata 方法，传递空对象
      await messageModel.updateMetadata('msg-empty-metadata', {});

      // 断言结果 - 原始 metadata 应该保持不变
      const result = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-empty-metadata'));

      expect(result[0].metadata).toEqual({ originalKey: 'originalValue' });
    });

    it('should handle message with null metadata', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({
        id: 'msg-null-metadata',
        userId,
        role: 'user',
        content: 'test message',
        metadata: null,
      });

      // 调用 updateMetadata 方法
      await messageModel.updateMetadata('msg-null-metadata', { key: 'value' });

      // 断言结果 - 应该创建新的 metadata
      const result = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-null-metadata'));

      expect(result[0].metadata).toEqual({ key: 'value' });
    });

    it('should only update messages belonging to the current user', async () => {
      // 创建测试数据 - 其他用户的消息
      await serverDB.insert(messages).values({
        id: 'msg-other-user',
        userId: '456',
        role: 'user',
        content: 'test message',
        metadata: { originalKey: 'originalValue' },
      });

      // 调用 updateMetadata 方法
      const result = await messageModel.updateMetadata('msg-other-user', {
        hackedKey: 'hackedValue',
      });

      // 断言结果 - 应该返回 undefined
      expect(result).toBeUndefined();

      // 验证原始 metadata 未被修改
      const dbResult = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-other-user'));

      expect(dbResult[0].metadata).toEqual({ originalKey: 'originalValue' });
    });

    it('should handle complex nested metadata updates', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values({
        id: 'msg-complex-metadata',
        userId,
        role: 'assistant',
        content: 'test message',
        metadata: {
          config: {
            settings: {
              enabled: true,
              options: ['a', 'b'],
            },
            version: 1,
          },
        },
      });

      // 调用 updateMetadata 方法
      await messageModel.updateMetadata('msg-complex-metadata', {
        config: {
          settings: {
            enabled: false,
            timeout: 5000,
          },
          newField: 'value',
        },
        stats: { count: 10 },
      });

      // 断言结果
      const result = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-complex-metadata'));

      expect(result[0].metadata).toEqual({
        config: {
          settings: {
            enabled: false,
            options: ['a', 'b'],
            timeout: 5000,
          },
          version: 1,
          newField: 'value',
        },
        stats: { count: 10 },
      });
    });
  });

  describe('updateTranslate', () => {
    it('should insert a new record if message does not exist in messageTranslates table', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 调用 updateTranslate 方法
      await messageModel.updateTranslate('1', {
        content: 'translated message 1',
        from: 'en',
        to: 'zh',
      });

      // 断言结果
      const result = await serverDB
        .select()
        .from(messageTranslates)
        .where(eq(messageTranslates.id, '1'));

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('translated message 1');
    });

    it('should update the corresponding fields if message exists in messageTranslates table', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(messages)
          .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);
        await trx
          .insert(messageTranslates)
          .values([{ id: '1', content: 'translated message 1', from: 'en', to: 'zh', userId }]);
      });

      // 调用 updateTranslate 方法
      await messageModel.updateTranslate('1', { content: 'updated translated message 1' });

      // 断言结果
      const result = await serverDB
        .select()
        .from(messageTranslates)
        .where(eq(messageTranslates.id, '1'));

      expect(result[0].content).toBe('updated translated message 1');
    });
  });

  describe('updateTTS', () => {
    it('should insert a new record if message does not exist in messageTTS table', async () => {
      // 创建测试数据
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 调用 updateTTS 方法
      await messageModel.updateTTS('1', { contentMd5: 'md5', file: 'f1', voice: 'voice1' });

      // 断言结果
      const result = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, '1'));

      expect(result).toHaveLength(1);
      expect(result[0].voice).toBe('voice1');
    });

    it('should update the corresponding fields if message exists in messageTTS table', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(messages)
          .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);
        await trx
          .insert(messageTTS)
          .values([{ id: '1', contentMd5: 'md5', fileId: 'f1', voice: 'voice1', userId }]);
      });

      // 调用 updateTTS 方法
      await messageModel.updateTTS('1', { voice: 'updated voice1' });

      // 断言结果
      const result = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, '1'));

      expect(result[0].voice).toBe('updated voice1');
    });
  });

  describe('deleteMessageTranslate', () => {
    it('should delete the message translate record', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([{ id: '1', role: 'abc', userId }]);
      await serverDB.insert(messageTranslates).values([{ id: '1', userId }]);

      // 调用 deleteMessageTranslate 方法
      await messageModel.deleteMessageTranslate('1');

      // 断言结果
      const result = await serverDB
        .select()
        .from(messageTranslates)
        .where(eq(messageTranslates.id, '1'));

      expect(result).toHaveLength(0);
    });
  });

  describe('deleteMessageTTS', () => {
    it('should delete the message TTS record', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([{ id: '1', role: 'abc', userId }]);
      await serverDB.insert(messageTTS).values([{ userId, id: '1' }]);

      // 调用 deleteMessageTTS 方法
      await messageModel.deleteMessageTTS('1');

      // 断言结果
      const result = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, '1'));
      expect(result).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('should return the count of messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: '456', role: 'user', content: 'message 3' },
      ]);

      // 调用 count 方法
      const result = await messageModel.count();

      // 断言结果
      expect(result).toBe(2);
    });

    describe('count with date filters', () => {
      beforeEach(async () => {
        // 创建测试数据，包含不同日期的消息
        await serverDB.insert(messages).values([
          {
            id: 'date1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-15'),
          },
          {
            id: 'date2',
            userId,
            role: 'user',
            content: 'message 2',
            createdAt: new Date('2023-02-15'),
          },
          {
            id: 'date3',
            userId,
            role: 'user',
            content: 'message 3',
            createdAt: new Date('2023-03-15'),
          },
          {
            id: 'date4',
            userId,
            role: 'user',
            content: 'message 4',
            createdAt: new Date('2023-04-15'),
          },
        ]);
      });

      it('should count messages with startDate filter', async () => {
        const result = await messageModel.count({ startDate: '2023-02-01' });
        expect(result).toBe(3); // 2月15日, 3月15日, 4月15日的消息
      });

      it('should count messages with endDate filter', async () => {
        const result = await messageModel.count({ endDate: '2023-03-01' });
        expect(result).toBe(2); // 1月15日, 2月15日的消息
      });

      it('should count messages with both startDate and endDate filters', async () => {
        const result = await messageModel.count({
          startDate: '2023-02-01',
          endDate: '2023-03-31',
        });
        expect(result).toBe(2); // 2月15日, 3月15日的消息
      });

      it('should count messages with range filter', async () => {
        const result = await messageModel.count({
          range: ['2023-02-01', '2023-04-01'],
        });
        expect(result).toBe(2); // 2月15日, 3月15日的消息
      });

      it('should handle edge cases in date filters', async () => {
        // 边界日期
        const result1 = await messageModel.count({
          startDate: '2023-01-15',
          endDate: '2023-04-15',
        });
        expect(result1).toBe(4); // 包含所有消息

        // 没有消息的日期范围
        const result2 = await messageModel.count({
          startDate: '2023-05-01',
          endDate: '2023-06-01',
        });
        expect(result2).toBe(0);

        // 精确到一天
        const result3 = await messageModel.count({
          startDate: '2023-01-15',
          endDate: '2023-01-15',
        });
        expect(result3).toBe(1);
      });
    });
  });

  describe('findMessageQueriesById', () => {
    it('should return undefined for non-existent message query', async () => {
      const result = await messageModel.findMessageQueriesById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return message query with embeddings', async () => {
      const query1Id = uuid();
      const embeddings1Id = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({ id: 'msg1', userId, role: 'user', content: 'abc' });

        await trx.insert(embeddings).values({
          id: embeddings1Id,
          embeddings: codeEmbedding,
        });

        await trx.insert(messageQueries).values({
          id: query1Id,
          messageId: 'msg1',
          userQuery: 'test query',
          rewriteQuery: 'rewritten query',
          embeddingsId: embeddings1Id,
          userId,
        });
      });

      const result = await messageModel.findMessageQueriesById('msg1');

      expect(result).toBeDefined();
      expect(result).toMatchObject({
        id: query1Id,
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        embeddings: codeEmbedding,
      });
    });
  });

  describe('deleteMessagesBySession', () => {
    it('should delete messages by session ID', async () => {
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          sessionId: 'session1',
          role: 'user',
          content: 'message 1',
        },
        {
          id: '2',
          userId,
          sessionId: 'session1',
          role: 'assistant',
          content: 'message 2',
        },
        {
          id: '3',
          userId,
          sessionId: 'session2',
          role: 'user',
          content: 'message 3',
        },
      ]);

      await messageModel.deleteMessagesBySession('session1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe('3');
    });

    it('should delete messages by session ID and topic ID', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'message 1',
        },
        {
          id: '2',
          userId,
          sessionId: 'session1',
          topicId: 'topic2',
          role: 'assistant',
          content: 'message 2',
        },
      ]);

      await messageModel.deleteMessagesBySession('session1', 'topic1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe('2');
    });
  });

  describe('genId', () => {
    it('should generate unique message IDs', () => {
      const model = new MessageModel(serverDB, userId);
      // @ts-ignore - accessing private method for testing
      const id1 = model.genId();
      // @ts-ignore - accessing private method for testing
      const id2 = model.genId();

      expect(id1).toHaveLength(18);
      expect(id2).toHaveLength(18);
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_/);
      expect(id2).toMatch(/^msg_/);
    });
  });

  describe('countWords', () => {
    it('should count total words of messages belonging to the user', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'hello world' },
        { id: '2', userId, role: 'user', content: 'test message' },
        { id: '3', userId: '456', role: 'user', content: 'other user message' },
      ]);

      // 调用 countWords 方法
      const result = await messageModel.countWords();

      // 断言结果 - 'hello world' + 'test message' = 23 characters
      expect(result).toEqual(23);
    });

    it('should count words within date range', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'old message',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'new message',
          createdAt: new Date('2023-06-01'),
        },
      ]);

      // 调用 countWords 方法，设置日期范围
      const result = await messageModel.countWords({
        range: ['2023-05-01', '2023-07-01'],
      });

      // 断言结果 - 只计算 'new message' = 11 characters
      expect(result).toEqual(11);
    });

    it('should handle empty content', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: '' },
        { id: '2', userId, role: 'user', content: null },
      ]);

      // 调用 countWords 方法
      const result = await messageModel.countWords();

      // 断言结果
      expect(result).toEqual(0);
    });
  });

  describe('getHeatmaps', () => {
    it('should return heatmap data for the last year', async () => {
      // 使用固定日期进行测试
      vi.useFakeTimers();
      const fixedDate = new Date('2023-04-07T13:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // 创建测试数据
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '3',
          userId,
          role: 'user',
          content: 'message 3',
          createdAt: today.subtract(1, 'day').toDate(),
        },
      ]);

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // 断言结果
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查两天前的数据
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // 检查一天前的数据
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // 检查今天的数据
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should calculate correct levels based on message count', async () => {
      // 使用固定日期进行测试
      vi.useFakeTimers();
      const fixedDate = new Date('2023-05-15T12:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const fourDaysAgoDate = today.subtract(4, 'day').format('YYYY-MM-DD');
      const threeDaysAgoDate = today.subtract(3, 'day').format('YYYY-MM-DD');
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // 创建测试数据 - 不同数量的消息以测试不同的等级
      await serverDB.insert(messages).values([
        // 1 message - level 1
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: today.subtract(4, 'day').toDate(),
        },
        // 6 messages - level 2
        ...Array(6)
          .fill(0)
          .map((_, i) => ({
            id: `2-${i}`,
            userId,
            role: 'user',
            content: `message 2-${i}`,
            createdAt: today.subtract(3, 'day').toDate(),
          })),
        // 11 messages - level 3
        ...Array(11)
          .fill(0)
          .map((_, i) => ({
            id: `3-${i}`,
            userId,
            role: 'user',
            content: `message 3-${i}`,
            createdAt: today.subtract(2, 'day').toDate(),
          })),
        // 16 messages - level 4
        ...Array(16)
          .fill(0)
          .map((_, i) => ({
            id: `4-${i}`,
            userId,
            role: 'user',
            content: `message 4-${i}`,
            createdAt: today.subtract(1, 'day').toDate(),
          })),
        // 21 messages - level 4
        ...Array(21)
          .fill(0)
          .map((_, i) => ({
            id: `5-${i}`,
            userId,
            role: 'user',
            content: `message 5-${i}`,
            createdAt: today.toDate(),
          })),
      ]);

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // 检查不同天数的等级
      const fourDaysAgo = result.find((item) => item.date === fourDaysAgoDate);
      expect(fourDaysAgo?.count).toBe(1);
      expect(fourDaysAgo?.level).toBe(1);

      const threeDaysAgo = result.find((item) => item.date === threeDaysAgoDate);
      expect(threeDaysAgo?.count).toBe(6);
      expect(threeDaysAgo?.level).toBe(2);

      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(11);
      expect(twoDaysAgo?.level).toBe(3);

      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(16);
      expect(oneDayAgo?.level).toBe(4);

      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(21);
      expect(todayData?.level).toBe(4);

      vi.useRealTimers();
    });

    it.skip('should return time count correctly when 19:00 time', async () => {
      // 使用固定日期进行测试
      vi.useFakeTimers();
      const fixedDate = new Date('2025-04-02T19:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // 创建测试数据
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '3',
          userId,
          role: 'user',
          content: 'message 3',
          createdAt: today.subtract(1, 'day').toDate(),
        },
      ]);

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // 断言结果
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查两天前的数据
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // 检查一天前的数据
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // 检查今天的数据
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should handle empty data', async () => {
      // 不创建任何消息数据

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // 断言结果
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查所有数据的 count 和 level 是否为 0
      result.forEach((item) => {
        expect(item.count).toBe(0);
        expect(item.level).toBe(0);
      });
    });
  });

  describe('rankModels', () => {
    it('should rank models by usage count', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-4' },
        { id: '4', userId: '456', role: 'assistant', content: 'message 4', model: 'gpt-3.5' }, // 其他用户的消息
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 2 }); // 当前用户使用 gpt-3.5 两次
      expect(result[1]).toEqual({ id: 'gpt-4', count: 1 }); // 当前用户使用 gpt-4 一次
    });

    it('should only count messages with model field', async () => {
      // 创建测试数据，包括没有 model 字段的消息
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: null },
        { id: '3', userId, role: 'user', content: 'message 3' }, // 用户消息通常没有 model
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // 断言结果
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 1 });
    });

    it('should return empty array when no models are used', async () => {
      // 创建测试数据，所有消息都没有 model
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'assistant', content: 'message 2' },
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // 断言结果
      expect(result).toHaveLength(0);
    });

    it('should order models by count in descending order', async () => {
      // 创建测试数据，使用不同次数的模型
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-4' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-3.5' },
        { id: '4', userId, role: 'assistant', content: 'message 4', model: 'claude' },
        { id: '5', userId, role: 'assistant', content: 'message 5', model: 'gpt-3.5' },
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // 断言结果
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 3 }); // 最多使用
      expect(result[1]).toEqual({ id: 'claude', count: 1 });
      expect(result[2]).toEqual({ id: 'gpt-4', count: 1 });
    });
  });

  describe('hasMoreThanN', () => {
    it('should return true when message count is greater than N', async () => {
      // 创建测试数据
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId, role: 'user', content: 'message 3' },
      ]);

      // 测试不同的 N 值
      const result1 = await messageModel.hasMoreThanN(2); // 3 > 2
      const result2 = await messageModel.hasMoreThanN(3); // 3 ≯ 3
      const result3 = await messageModel.hasMoreThanN(4); // 3 ≯ 4

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    it('should only count messages belonging to the user', async () => {
      // 创建测试数据，包括其他用户的消息
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: '456', role: 'user', content: 'message 3' }, // 其他用户的消息
      ]);

      const result = await messageModel.hasMoreThanN(2);

      expect(result).toBe(false); // 当前用户只有 2 条消息，不大于 2
    });

    it('should return false when no messages exist', async () => {
      const result = await messageModel.hasMoreThanN(0);
      expect(result).toBe(false);
    });

    it('should handle edge cases', async () => {
      // 创建一条消息
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 测试边界情况
      const result1 = await messageModel.hasMoreThanN(0); // 1 > 0
      const result2 = await messageModel.hasMoreThanN(1); // 1 ≯ 1
      const result3 = await messageModel.hasMoreThanN(-1); // 1 > -1

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });

  describe('replaceMessageQuery', () => {
    it('should insert a message query when none exists', async () => {
      await serverDB.insert(messages).values({
        id: 'msg-query-insert',
        userId,
        role: 'user',
        content: 'test message',
      });

      const result = await messageModel.replaceMessageQuery({
        messageId: 'msg-query-insert',
        userQuery: 'original query',
        rewriteQuery: 'rewritten query',
        embeddingsId,
      });

      expect(result).toMatchObject({
        embeddingsId,
        messageId: 'msg-query-insert',
        rewriteQuery: 'rewritten query',
        userId,
        userQuery: 'original query',
      });
      expect(
        await serverDB
          .select()
          .from(messageQueries)
          .where(eq(messageQueries.messageId, 'msg-query-insert')),
      ).toHaveLength(1);
    });

    it('should replace the existing query and delete its superseded embedding', async () => {
      const oldEmbeddingsId = uuid();
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({
          id: 'msg-query-replace',
          userId,
          role: 'user',
          content: 'test message',
        });
        await trx.insert(embeddings).values({
          id: oldEmbeddingsId,
          embeddings: codeEmbedding,
          userId,
        });
      });

      const original = await messageModel.replaceMessageQuery({
        messageId: 'msg-query-replace',
        userQuery: 'original query',
        rewriteQuery: 'original rewrite',
        embeddingsId: oldEmbeddingsId,
      });
      const replacement = await messageModel.replaceMessageQuery({
        messageId: 'msg-query-replace',
        userQuery: 'replacement query',
        rewriteQuery: 'replacement rewrite',
        embeddingsId,
      });

      expect(replacement).toMatchObject({
        embeddingsId,
        id: original.id,
        rewriteQuery: 'replacement rewrite',
        userQuery: 'replacement query',
      });
      expect(
        await serverDB
          .select()
          .from(messageQueries)
          .where(eq(messageQueries.messageId, 'msg-query-replace')),
      ).toHaveLength(1);
      expect(
        await serverDB.select().from(embeddings).where(eq(embeddings.id, oldEmbeddingsId)),
      ).toHaveLength(0);
      expect(
        await serverDB.select().from(embeddings).where(eq(embeddings.id, embeddingsId)),
      ).toHaveLength(1);
    });

    it('should not replace another user query or delete its embedding', async () => {
      const otherEmbeddingsId = uuid();
      const otherQueryId = uuid();
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({
          id: 'msg-query-owned',
          userId,
          role: 'user',
          content: 'test message',
        });
        await trx.insert(embeddings).values({
          id: otherEmbeddingsId,
          embeddings: codeEmbedding,
          userId: '456',
        });
        await trx.insert(messageQueries).values({
          embeddingsId: otherEmbeddingsId,
          id: otherQueryId,
          messageId: 'msg-query-owned',
          rewriteQuery: 'other rewrite',
          userId: '456',
          userQuery: 'other query',
        });
      });

      const result = await messageModel.replaceMessageQuery({
        messageId: 'msg-query-owned',
        userQuery: 'current query',
        rewriteQuery: 'current rewrite',
        embeddingsId,
      });
      const rows = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.messageId, 'msg-query-owned'));

      expect(result.userId).toBe(userId);
      expect(rows).toHaveLength(2);
      expect(rows.find(({ id }) => id === otherQueryId)).toMatchObject({
        embeddingsId: otherEmbeddingsId,
        rewriteQuery: 'other rewrite',
        userId: '456',
        userQuery: 'other query',
      });
      expect(
        await serverDB.select().from(embeddings).where(eq(embeddings.id, otherEmbeddingsId)),
      ).toHaveLength(1);
    });
  });

  describe('updateMessageRAG', () => {
    it('should insert message query chunks for RAG', async () => {
      // prepare message and query
      const messageId = 'rag-msg-1';
      const queryId = uuid();
      const chunk1 = uuid();
      const chunk2 = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({ id: messageId, role: 'user', userId, content: 'c' });
        await trx.insert(chunks).values([
          { id: chunk1, text: 'a' },
          { id: chunk2, text: 'b' },
        ]);
        await trx
          .insert(messageQueries)
          .values({ id: queryId, messageId, userId, userQuery: 'q', rewriteQuery: 'rq' });
      });

      await messageModel.updateMessageRAG(messageId, {
        ragQueryId: queryId,
        fileChunks: [
          { id: chunk1, similarity: 0.9 },
          { id: chunk2, similarity: 0.8 },
        ],
      });

      const rows = await serverDB
        .select()
        .from(messageQueryChunks)
        .where(eq(messageQueryChunks.messageId, messageId));

      expect(rows).toHaveLength(2);
      const s1 = rows.find((r) => r.chunkId === chunk1)!;
      const s2 = rows.find((r) => r.chunkId === chunk2)!;
      expect(s1.queryId).toBe(queryId);
      expect(s1.similarity).toBe('0.90000');
      expect(s2.similarity).toBe('0.80000');
    });
  });

  describe('deleteMessageQuery', () => {
    it('should delete a message query by ID', async () => {
      // 创建测试数据
      const queryId = uuid();
      await serverDB.insert(messages).values({
        id: 'msg4',
        userId,
        role: 'user',
        content: 'test message',
      });

      await serverDB.insert(messageQueries).values({
        id: queryId,
        messageId: 'msg4',
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        userId,
      });

      // 验证查询已创建
      const beforeDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(beforeDelete).toHaveLength(1);

      // 调用 deleteMessageQuery 方法
      await messageModel.deleteMessageQuery(queryId);

      // 验证查询已删除
      const afterDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(afterDelete).toHaveLength(0);
    });

    it('should only delete message queries belonging to the user', async () => {
      // 创建测试数据 - 其他用户的查询
      const queryId = uuid();
      await serverDB.insert(messages).values({
        id: 'msg5',
        userId: '456',
        role: 'user',
        content: 'test message',
      });

      await serverDB.insert(messageQueries).values({
        id: queryId,
        messageId: 'msg5',
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        userId: '456', // 其他用户
      });

      // 调用 deleteMessageQuery 方法
      await messageModel.deleteMessageQuery(queryId);

      // 验证查询未被删除
      const afterDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(afterDelete).toHaveLength(1);
    });

    it('should throw error when deleting non-existent message query', async () => {
      // 调用 deleteMessageQuery 方法删除不存在的查询
      try {
        await messageModel.deleteMessageQuery('non-existent-id');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });
});
