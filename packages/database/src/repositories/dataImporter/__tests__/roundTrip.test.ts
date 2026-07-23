import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import migrations from '@/database/core/migrations.json';
import { ImportPgDataStructure } from '@/types/export';

import { getTestDB } from '../../../models/__tests__/_util';
import * as Schema from '../../../schemas';
import { DATA_BACKUP_REGISTRY } from '../../dataBackupRegistry';
import { DataExporterRepos } from '../../dataExporter';
import { DataImporterRepos } from '../index';

const database = await getTestDB();
const sourceUserId = 'backup-source-user';
const targetUserId = 'backup-target-user';
const now = new Date('2026-01-02T03:04:05.000Z');

beforeEach(async () => {
  await database.delete(Schema.users);
  await database.insert(Schema.users).values([
    {
      id: sourceUserId,
      isOnboarded: true,
      preference: { guide: { moveSettingsToAvatar: true } },
    },
    { id: targetUserId },
  ]);
});

describe('database backup round trip', () => {
  it('uses one registry with dependency-safe relations', () => {
    const tablePositions = new Map(
      DATA_BACKUP_REGISTRY.map(({ table }, index) => [table, index] as const),
    );

    for (const [index, config] of DATA_BACKUP_REGISTRY.entries()) {
      for (const relation of config.relations || []) {
        expect(tablePositions.has(relation.sourceTable)).toBe(true);
        if (!relation.deferred) {
          expect(tablePositions.get(relation.sourceTable)).toBeLessThan(index);
        }
      }
    }
  });

  it('restores current core data and relationships for another user idempotently', async () => {
    await database.transaction(async (transaction) => {
      await transaction.insert(Schema.userSettings).values({
        general: { fontSize: 15 },
        id: sourceUserId,
        keyVaults: 'encrypted-user-vault',
      });
      await transaction.insert(Schema.userInstalledPlugins).values({
        identifier: 'test-plugin',
        type: 'plugin',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.aiProviders).values({
        id: 'test-provider',
        keyVaults: 'encrypted-provider-vault',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.aiModels).values({
        id: 'test-model',
        providerId: 'test-provider',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.userMemories).values({
        id: 'mem-source',
        lastAccessedAt: now,
        title: 'Remember this',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.userMemoriesContexts).values({
        id: 'mem-context-source',
        title: 'Context',
        userId: sourceUserId,
        userMemoryIds: ['mem-source'],
      });
      await transaction.insert(Schema.userMemoriesPreferences).values({
        id: 'mem-preference-source',
        type: 'preference',
        userId: sourceUserId,
        userMemoryId: 'mem-source',
      });
      await transaction.insert(Schema.userMemoriesIdentities).values({
        episodicDate: now,
        id: 'mem-identity-source',
        type: 'identity',
        userId: sourceUserId,
        userMemoryId: 'mem-source',
      });
      await transaction.insert(Schema.userMemoriesExperiences).values({
        id: 'mem-experience-source',
        type: 'experience',
        userId: sourceUserId,
        userMemoryId: 'mem-source',
      });
      await transaction.insert(Schema.sessionGroups).values({
        id: 'session-group-source',
        name: 'Source group',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.agents).values({
        id: 'agent-source',
        slug: 'backup-agent',
        title: 'Backup agent',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.sessions).values({
        groupId: 'session-group-source',
        id: 'session-source',
        slug: 'backup-session',
        title: 'Backup session',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.chatGroups).values({
        groupId: 'session-group-source',
        id: 'chat-group-source',
        title: 'Backup chat group',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.topics).values({
        groupId: 'chat-group-source',
        id: 'topic-source',
        lastActivityAt: now,
        sessionId: 'session-source',
        title: 'Backup topic',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.threads).values({
        id: 'thread-source',
        lastActiveAt: now,
        sourceMessageId: 'message-user-source',
        topicId: 'topic-source',
        type: 'standalone',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.messageGroups).values({
        id: 'message-group-source',
        topicId: 'topic-source',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.messages).values([
        {
          agentId: 'agent-source',
          content: 'Question',
          groupId: 'chat-group-source',
          id: 'message-user-source',
          messageGroupId: 'message-group-source',
          role: 'user',
          sessionId: 'session-source',
          targetId: 'agent-source',
          threadId: 'thread-source',
          topicId: 'topic-source',
          userId: sourceUserId,
        },
        {
          agentId: 'agent-source',
          content: 'Answer',
          groupId: 'chat-group-source',
          id: 'message-assistant-source',
          messageGroupId: 'message-group-source',
          parentId: 'message-user-source',
          quotaId: 'message-user-source',
          role: 'assistant',
          sessionId: 'session-source',
          threadId: 'thread-source',
          topicId: 'topic-source',
          userId: sourceUserId,
        },
      ]);
      await transaction
        .update(Schema.messageGroups)
        .set({ parentMessageId: 'message-user-source' })
        .where(eq(Schema.messageGroups.id, 'message-group-source'));
      await transaction.insert(Schema.agentsToSessions).values({
        agentId: 'agent-source',
        sessionId: 'session-source',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.chatGroupsAgents).values({
        agentId: 'agent-source',
        chatGroupId: 'chat-group-source',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.messagePlugins).values({
        id: 'message-assistant-source',
        identifier: 'test-plugin',
        userId: sourceUserId,
      });
      await transaction.insert(Schema.messageTranslates).values({
        content: 'Translated answer',
        id: 'message-assistant-source',
        userId: sourceUserId,
      });
    });

    const data = await new DataExporterRepos(database, sourceUserId).export();
    expect(data.messageChunks).toBeUndefined();
    expect(data.users).toEqual([
      {
        isOnboarded: true,
        preference: { guide: { moveSettingsToAvatar: true } },
      },
    ]);
    expect(data.messages?.every((row) => !('messageOrder' in row) && !('userId' in row))).toBe(
      true,
    );

    const backup: ImportPgDataStructure = {
      data,
      mode: 'postgres',
      schemaHash: migrations.at(-1)!.hash,
    };
    const importer = new DataImporterRepos(database, targetUserId);
    const firstResult = await importer.importPgData(backup);
    expect(firstResult.success).toBe(true);

    const targetAgent = await database.query.agents.findFirst({
      where: eq(Schema.agents.userId, targetUserId),
    });
    const targetMessages = await database.query.messages.findMany({
      where: eq(Schema.messages.userId, targetUserId),
    });
    const targetUserMessage = targetMessages.find(({ content }) => content === 'Question')!;
    const targetAssistantMessage = targetMessages.find(({ content }) => content === 'Answer')!;
    const targetThread = await database.query.threads.findFirst({
      where: eq(Schema.threads.userId, targetUserId),
    });
    const targetMessageGroup = await database.query.messageGroups.findFirst({
      where: eq(Schema.messageGroups.userId, targetUserId),
    });
    const targetMemory = await database.query.userMemories.findFirst({
      where: eq(Schema.userMemories.userId, targetUserId),
    });
    const targetMemoryContext = await database.query.userMemoriesContexts.findFirst({
      where: eq(Schema.userMemoriesContexts.userId, targetUserId),
    });
    const targetMemoryPreference = await database.query.userMemoriesPreferences.findFirst({
      where: eq(Schema.userMemoriesPreferences.userId, targetUserId),
    });

    expect(targetAgent?.clientId).toBe('agent-source');
    expect(targetUserMessage.targetId).toBe(targetAgent?.id);
    expect(targetAssistantMessage.parentId).toBe(targetUserMessage.id);
    expect(targetAssistantMessage.quotaId).toBe(targetUserMessage.id);
    expect(targetThread?.sourceMessageId).toBe(targetUserMessage.id);
    expect(targetMessageGroup?.parentMessageId).toBe(targetUserMessage.id);
    expect(targetMemoryContext?.userMemoryIds).toEqual([targetMemory?.id]);
    expect(targetMemoryPreference?.userMemoryId).toBe(targetMemory?.id);
    expect(targetMemory?.lastAccessedAt).toBeInstanceOf(Date);

    const countsBeforeSecondImport = {
      agents: await database.query.agents.findMany({
        where: eq(Schema.agents.userId, targetUserId),
      }),
      messages: targetMessages,
      memories: await database.query.userMemories.findMany({
        where: eq(Schema.userMemories.userId, targetUserId),
      }),
    };
    const secondResult = await importer.importPgData(backup);
    expect(secondResult.success).toBe(true);
    expect(
      await database.query.agents.findMany({ where: eq(Schema.agents.userId, targetUserId) }),
    ).toHaveLength(countsBeforeSecondImport.agents.length);
    expect(
      await database.query.messages.findMany({ where: eq(Schema.messages.userId, targetUserId) }),
    ).toHaveLength(countsBeforeSecondImport.messages.length);
    expect(
      await database.query.userMemories.findMany({
        where: eq(Schema.userMemories.userId, targetUserId),
      }),
    ).toHaveLength(countsBeforeSecondImport.memories.length);
  });

  it('rolls back a failed replace and preserves the original target data', async () => {
    await database.insert(Schema.sessions).values({
      id: 'target-existing-session',
      slug: 'target-existing-session',
      title: 'Keep me',
      userId: targetUserId,
    });
    const invalidBackup: ImportPgDataStructure = {
      data: {
        agents: [{ id: 'new-agent', title: 'Must roll back' }],
        threads: [
          {
            id: 'broken-thread',
            sourceMessageId: 'missing-message',
            topicId: 'new-topic',
            type: 'standalone',
          },
        ],
        topics: [{ id: 'new-topic', title: 'New topic' }],
      },
      mode: 'postgres',
      schemaHash: migrations.at(-1)!.hash,
    };

    const result = await new DataImporterRepos(database, targetUserId).importPgData(
      invalidBackup,
      'replace',
    );

    expect(result.success).toBe(false);
    expect(
      await database.query.sessions.findFirst({
        where: eq(Schema.sessions.id, 'target-existing-session'),
      }),
    ).toMatchObject({ title: 'Keep me' });
    expect(
      await database.query.agents.findMany({ where: eq(Schema.agents.userId, targetUserId) }),
    ).toHaveLength(0);
  });

  it('removes current in-scope data after a successful replace', async () => {
    await database.insert(Schema.sessions).values({
      id: 'target-old-session',
      slug: 'target-old-session',
      title: 'Remove me',
      userId: targetUserId,
    });
    const replacement: ImportPgDataStructure = {
      data: {
        sessions: [
          {
            id: 'source-new-session',
            slug: 'source-new-session',
            title: 'Replacement',
          },
        ],
      },
      mode: 'postgres',
      schemaHash: migrations.at(-1)!.hash,
    };

    const result = await new DataImporterRepos(database, targetUserId).importPgData(
      replacement,
      'replace',
    );

    expect(result.success).toBe(true);
    const sessions = await database.query.sessions.findMany({
      where: eq(Schema.sessions.userId, targetUserId),
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      clientId: 'source-new-session',
      title: 'Replacement',
    });
  });
});
