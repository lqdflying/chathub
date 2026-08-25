// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { files, users } from '../../schemas';
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

describe('FileModel.deleteImageArtifacts', () => {
  it('deletes only the current user image-generation files', async () => {
    const removed = await fileModel.deleteImageArtifacts([
      'artifact-old',
      'uploaded-image',
      'other-user-artifact',
    ]);

    expect(removed.map(({ id }) => id)).toEqual(['artifact-old']);

    const remaining = await serverDB.select({ id: files.id }).from(files);
    expect(remaining.map(({ id }) => id).sort()).toEqual([
      'artifact-new',
      'other-user-artifact',
      'uploaded-image',
    ]);
  });

  it('returns an empty list when ids are empty or not artifacts', async () => {
    await expect(fileModel.deleteImageArtifacts([])).resolves.toEqual([]);
    await expect(fileModel.deleteImageArtifacts(['uploaded-image'])).resolves.toEqual([]);

    const remaining = await fileModel.queryImageArtifacts();
    expect(remaining.total).toBe(2);
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
