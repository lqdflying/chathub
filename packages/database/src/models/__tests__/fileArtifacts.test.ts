// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { files, generationBatches, generationTopics, generations, globalFiles, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'file-artifacts-user';
const otherUserId = 'file-artifacts-other-user';
const fileModel = new FileModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  await serverDB.insert(files).values([
    {
      createdAt: new Date('2026-07-01T00:00:00Z'),
      fileType: 'image/png',
      id: 'artifact-old',
      metadata: { height: 768, width: 1024 },
      name: 'Sunrise.png',
      size: 100,
      source: FileSource.ImageGeneration,
      url: 'generations/images/sunrise.png',
      userId,
    },
    {
      createdAt: new Date('2026-07-02T00:00:00Z'),
      fileType: 'image/webp',
      id: 'artifact-new',
      metadata: { height: 512, width: 512 },
      name: 'City lights.webp',
      size: 200,
      source: FileSource.ImageGeneration,
      url: 'generations/images/city.webp',
      userId,
    },
    {
      fileType: 'image/png',
      id: 'uploaded-image',
      name: 'Upload.png',
      size: 300,
      url: 'files/upload.png',
      userId,
    },
    {
      fileType: 'image/png',
      id: 'other-user-artifact',
      name: 'Private.png',
      size: 400,
      source: FileSource.ImageGeneration,
      url: 'generations/images/private.png',
      userId: otherUserId,
    },
  ]);
});

const insertWorkspaceGeneration = async ({
  fileId,
  generationId,
  thumbnailUrl,
  url,
}: {
  fileId: string;
  generationId: string;
  thumbnailUrl?: string;
  url?: string;
}) => {
  await serverDB.insert(generationTopics).values({
    id: `topic-${generationId}`,
    userId,
  });
  await serverDB.insert(generationBatches).values({
    generationTopicId: `topic-${generationId}`,
    id: `batch-${generationId}`,
    model: 'model',
    prompt: 'prompt',
    provider: 'provider',
    userId,
  });
  await serverDB.insert(generations).values({
    asset: {
      originalUrl: 'https://provider.example/original.png',
      thumbnailUrl,
      type: 'image',
      url,
    },
    fileId,
    generationBatchId: `batch-${generationId}`,
    id: generationId,
    userId,
  });
};

describe('FileModel.deleteImageArtifacts', () => {
  it('deletes only the current user image-generation files', async () => {
    const removed = await fileModel.deleteImageArtifacts([
      'artifact-old',
      'uploaded-image',
      'other-user-artifact',
    ]);

    expect(removed).toEqual({
      deletedIds: ['artifact-old'],
      storageKeys: ['generations/images/sunrise.png'],
    });

    const remaining = await serverDB.select({ id: files.id }).from(files);
    expect(remaining.map(({ id }) => id).sort()).toEqual([
      'artifact-new',
      'other-user-artifact',
      'uploaded-image',
    ]);
  });

  it('returns an empty list when ids are empty or not artifacts', async () => {
    await expect(fileModel.deleteImageArtifacts([])).resolves.toEqual({
      deletedIds: [],
      storageKeys: [],
    });
    await expect(fileModel.deleteImageArtifacts(['uploaded-image'])).resolves.toEqual({
      deletedIds: [],
      storageKeys: [],
    });

    const remaining = await fileModel.queryImageArtifacts();
    expect(remaining.total).toBe(2);
  });

  it('returns distinct original and thumbnail keys for a workspace generation', async () => {
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-distinct-thumb',
      thumbnailUrl: 'generations/thumbnails/sunrise.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.deletedIds).toEqual(['artifact-old']);
    expect(removed.storageKeys.sort()).toEqual([
      'generations/images/sunrise.png',
      'generations/thumbnails/sunrise.webp',
    ]);
    await expect(
      serverDB.select({ id: generations.id }).from(generations),
    ).resolves.toEqual([]);
  });

  it('deletes a same-key original/thumbnail once and skips provider originalUrl', async () => {
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-same-thumb',
      thumbnailUrl: 'generations/images/sunrise.png',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed).toEqual({
      deletedIds: ['artifact-old'],
      storageKeys: ['generations/images/sunrise.png'],
    });
  });

  it('deduplicates a same-key original when the thumbnail is a legacy full URL', async () => {
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-legacy-same-thumb',
      thumbnailUrl: 'https://s3.example.com/bucket/generations/images/sunrise.png',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed).toEqual({
      deletedIds: ['artifact-old'],
      storageKeys: ['generations/images/sunrise.png'],
    });
  });

  it('does not delete a thumbnail still used as another file url', async () => {
    await serverDB.insert(files).values({
      fileType: 'image/webp',
      id: 'shared-thumb-file',
      name: 'Shared.webp',
      size: 10,
      source: FileSource.ImageGeneration,
      url: 'generations/thumbnails/shared.webp',
      userId: otherUserId,
    });
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-shared-thumb',
      thumbnailUrl: 'generations/thumbnails/shared.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.storageKeys.sort()).toEqual(['generations/images/sunrise.png']);
    const remainingIds = (await serverDB.select({ id: files.id }).from(files)).map(({ id }) => id);
    expect(remainingIds).toContain('shared-thumb-file');
    expect(remainingIds).not.toContain('artifact-old');
  });

  it('returns a normalized thumbnail key for a legacy full storage URL', async () => {
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-legacy-thumb',
      thumbnailUrl: 'https://s3.example.com/bucket/generations/thumbnails/sunrise.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.deletedIds).toEqual(['artifact-old']);
    expect(removed.storageKeys.sort()).toEqual([
      'generations/images/sunrise.png',
      'generations/thumbnails/sunrise.webp',
    ]);
  });

  it('protects a remaining bare-key file when the thumbnail is a full storage URL', async () => {
    await serverDB.insert(files).values({
      fileType: 'image/webp',
      id: 'shared-legacy-thumb-file',
      name: 'Shared.webp',
      size: 10,
      source: FileSource.ImageGeneration,
      url: 'generations/thumbnails/shared-legacy.webp',
      userId: otherUserId,
    });
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-legacy-shared-thumb',
      thumbnailUrl: 'https://s3.example.com/bucket/generations/thumbnails/shared-legacy.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.storageKeys.sort()).toEqual(['generations/images/sunrise.png']);
    const remainingIds = (await serverDB.select({ id: files.id }).from(files)).map(({ id }) => id);
    expect(remainingIds).toContain('shared-legacy-thumb-file');
  });

  it('protects a remaining full-URL file when the thumbnail is a bare key', async () => {
    await serverDB.insert(files).values({
      fileType: 'image/webp',
      id: 'shared-full-url-thumb-file',
      name: 'Shared.webp',
      size: 10,
      source: FileSource.ImageGeneration,
      url: 'https://s3.example.com/bucket/generations/thumbnails/shared-full.webp',
      userId: otherUserId,
    });
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-bare-shared-thumb',
      thumbnailUrl: 'generations/thumbnails/shared-full.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.storageKeys.sort()).toEqual(['generations/images/sunrise.png']);
    const remainingIds = (await serverDB.select({ id: files.id }).from(files)).map(({ id }) => id);
    expect(remainingIds).toContain('shared-full-url-thumb-file');
  });

  it('protects a remaining global_files bare key against a full-URL thumbnail', async () => {
    await serverDB.insert(globalFiles).values({
      creator: otherUserId,
      fileType: 'image/webp',
      hashId: 'shared-global-thumb-hash',
      size: 10,
      url: 'generations/thumbnails/shared-global.webp',
    });
    await insertWorkspaceGeneration({
      fileId: 'artifact-old',
      generationId: 'gen-global-shared-thumb',
      thumbnailUrl: 'https://s3.example.com/bucket/generations/thumbnails/shared-global.webp',
      url: 'generations/images/sunrise.png',
    });

    const removed = await fileModel.deleteImageArtifacts(['artifact-old']);

    expect(removed.storageKeys.sort()).toEqual(['generations/images/sunrise.png']);
  });
});

describe('FileModel.queryImageArtifacts', () => {
  it('returns only the current user image-generation files with dimensions', async () => {
    const result = await fileModel.queryImageArtifacts();

    expect(result.total).toBe(2);
    expect(result.items.map(({ id }) => id)).toEqual(['artifact-new', 'artifact-old']);
    expect(result.items[0]).toMatchObject({ height: 512, width: 512 });
  });

  it('supports prompt-name search, ascending sort, and pagination', async () => {
    const searchResult = await fileModel.queryImageArtifacts({ q: 'sunRISE' });
    expect(searchResult.items.map(({ id }) => id)).toEqual(['artifact-old']);

    const pagedResult = await fileModel.queryImageArtifacts({
      page: 2,
      pageSize: 1,
      sort: 'oldest',
    });
    expect(pagedResult).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(pagedResult.items.map(({ id }) => id)).toEqual(['artifact-new']);
  });

  it('treats LIKE metacharacters in artifact search as literals', async () => {
    await serverDB.insert(files).values([
      {
        createdAt: new Date('2026-07-03T00:00:00Z'),
        fileType: 'image/png',
        id: 'artifact-literal-pattern',
        name: '50%_off.png',
        size: 100,
        source: FileSource.ImageGeneration,
        url: 'generations/images/literal-pattern.png',
        userId,
      },
      {
        createdAt: new Date('2026-07-04T00:00:00Z'),
        fileType: 'image/png',
        id: 'artifact-percent-wildcard',
        name: '500off.png',
        size: 100,
        source: FileSource.ImageGeneration,
        url: 'generations/images/percent-wildcard.png',
        userId,
      },
      {
        createdAt: new Date('2026-07-05T00:00:00Z'),
        fileType: 'image/png',
        id: 'artifact-underscore-wildcard',
        name: '50Xoff.png',
        size: 100,
        source: FileSource.ImageGeneration,
        url: 'generations/images/underscore-wildcard.png',
        userId,
      },
    ]);

    const percentResult = await fileModel.queryImageArtifacts({ q: '50%' });
    expect(percentResult.items.map(({ id }) => id)).toEqual(['artifact-literal-pattern']);

    const underscoreResult = await fileModel.queryImageArtifacts({ q: '_off' });
    expect(underscoreResult.items.map(({ id }) => id)).toEqual(['artifact-literal-pattern']);
  });
});
