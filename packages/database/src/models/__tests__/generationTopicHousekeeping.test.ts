// @vitest-environment node
import { AsyncTaskStatus, FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asyncTasks,
  files,
  generationBatches,
  generationTopics,
  generations,
  users,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';
import { GenerationTopicModel } from '../generationTopic';
import { getTestDB } from './_util';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ getFullFileUrl: vi.fn() })),
}));

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'generation-housekeeping-user';
const otherUserId = 'generation-housekeeping-other-user';
const model = new GenerationTopicModel(serverDB, userId);
const fileModel = new FileModel(serverDB, userId);
const now = new Date('2026-08-04T00:00:00Z');
const old = new Date('2026-05-01T00:00:00Z');
const recent = new Date('2026-08-01T00:00:00Z');

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now.valueOf());
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  await serverDB.insert(generationTopics).values([
    { coverUrl: 'covers/old.webp', id: 'old-topic', title: 'Old', updatedAt: old, userId },
    { id: 'recent-topic', title: 'Recent', updatedAt: recent, userId },
    { id: 'active-topic', title: 'Active', updatedAt: old, userId },
    { id: 'foreign-topic', title: 'Foreign', updatedAt: old, userId: otherUserId },
  ]);

  await serverDB.insert(files).values([
    {
      fileType: 'image/png',
      id: 'durable-artifact',
      metadata: { height: 512, width: 512 },
      name: 'Durable.png',
      size: 512,
      source: FileSource.ImageGeneration,
      url: 'generations/images/original.png',
      userId,
    },
    {
      fileType: 'image/webp',
      id: 'shared-durable-artifact',
      name: 'Shared durable.webp',
      size: 256,
      source: FileSource.ImageGeneration,
      url: 'generations/thumbnails/shared.webp',
      userId: otherUserId,
    },
  ]);

  const [oldBatch, activeBatch] = await serverDB
    .insert(generationBatches)
    .values([
      {
        createdAt: old,
        generationTopicId: 'old-topic',
        id: 'old-batch',
        model: 'model',
        prompt: 'old prompt',
        provider: 'provider',
        updatedAt: old,
        userId,
      },
      {
        createdAt: old,
        generationTopicId: 'active-topic',
        id: 'active-batch',
        model: 'model',
        prompt: 'active prompt',
        provider: 'provider',
        updatedAt: old,
        userId,
      },
    ])
    .returning();

  const [successTask, pendingTask] = await serverDB
    .insert(asyncTasks)
    .values([
      { status: AsyncTaskStatus.Success, type: 'image_generation', updatedAt: old, userId },
      { status: AsyncTaskStatus.Pending, type: 'image_generation', updatedAt: old, userId },
    ])
    .returning();

  await serverDB.insert(generations).values([
    {
      asset: {
        thumbnailUrl: 'generations/thumbnails/old.webp',
        type: 'image',
        url: 'generations/images/original.png',
      },
      asyncTaskId: successTask.id,
      createdAt: old,
      fileId: 'durable-artifact',
      generationBatchId: oldBatch.id,
      id: 'old-generation',
      updatedAt: old,
      userId,
    },
    {
      asset: {
        thumbnailUrl: 'generations/images/original.png',
        type: 'image',
        url: 'generations/images/original.png',
      },
      asyncTaskId: successTask.id,
      createdAt: old,
      fileId: 'durable-artifact',
      generationBatchId: oldBatch.id,
      id: 'legacy-colliding-thumbnail',
      updatedAt: old,
      userId,
    },
    {
      asset: {
        thumbnailUrl: 'generations/thumbnails/shared.webp',
        type: 'image',
      },
      asyncTaskId: successTask.id,
      createdAt: old,
      generationBatchId: oldBatch.id,
      id: 'legacy-shared-thumbnail',
      updatedAt: old,
      userId,
    },
    {
      asyncTaskId: pendingTask.id,
      createdAt: old,
      generationBatchId: activeBatch.id,
      id: 'active-generation',
      updatedAt: old,
      userId,
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users);
});

describe('GenerationTopicModel housekeeping', () => {
  it('previews and deletes old history while preserving original artifacts', async () => {
    await expect(model.previewHousekeeping({ days: 30, mode: 'olderThan' })).resolves.toMatchObject(
      {
        deletableTopicCount: 1,
        skippedActiveTopicCount: 1,
      },
    );

    const result = await model.housekeep({ days: 30, mode: 'olderThan' });

    expect(result.deletedTopicIds).toEqual(['old-topic']);
    expect(result.skippedActiveTopicCount).toBe(1);
    expect(result.filesToDelete).toEqual(
      expect.arrayContaining(['covers/old.webp', 'generations/thumbnails/old.webp']),
    );
    expect(result.filesToDelete).not.toContain('generations/images/original.png');
    expect(result.filesToDelete).not.toContain('generations/thumbnails/shared.webp');
    await expect(
      serverDB.query.files.findFirst({ where: eq(files.id, 'durable-artifact') }),
    ).resolves.toBeDefined();
    await expect(fileModel.queryImageArtifacts()).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: 'durable-artifact',
          url: 'generations/images/original.png',
        }),
      ],
      total: 1,
    });
    await expect(
      serverDB.query.generationTopics.findFirst({ where: eq(generationTopics.id, 'old-topic') }),
    ).resolves.toBeUndefined();
    await expect(
      serverDB.query.generationTopics.findFirst({ where: eq(generationTopics.id, 'active-topic') }),
    ).resolves.toBeDefined();
  });

  it('deletes all inactive user topics and leaves other users untouched', async () => {
    const result = await model.housekeep({ mode: 'all' });

    expect(new Set(result.deletedTopicIds)).toEqual(new Set(['old-topic', 'recent-topic']));
    expect(result.skippedActiveTopicCount).toBe(1);
    await expect(
      serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, 'foreign-topic'),
      }),
    ).resolves.toBeDefined();
  });

  it('blocks individual deletion while a generation is active', async () => {
    await expect(model.delete('active-topic')).resolves.toMatchObject({
      blockedByActiveTask: true,
      filesToDelete: [],
    });
  });
});
