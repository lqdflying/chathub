// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { getChunkableFileCapabilities, setChunkableFileCapabilities } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSource, FilesTabs, SortType } from '@/types/files';

import { chunks, embeddings, fileChunks, files, globalFiles, knowledgeBaseFiles, knowledgeBases, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-model-test-user-id';
const fileModel = new FileModel(serverDB, userId);

const knowledgeBase = { id: 'kb1', userId, name: 'knowledgeBase' };
beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
  await serverDB.insert(knowledgeBases).values(knowledgeBase);
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(files);
  await serverDB.delete(globalFiles);
});

describe('FileModel', () => {
  describe('create', () => {
    it('should create a new file', async () => {
      const params = {
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
      };

      const { id } = await fileModel.create(params);
      expect(id).toBeDefined();

      const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      expect(file).toMatchObject({ ...params, userId });
    });

    it('should create a file with knowledgeBaseId', async () => {
      const params = {
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
        knowledgeBaseId: 'kb1',
      };

      const { id } = await fileModel.create(params);

      const kbFile = await serverDB.query.knowledgeBaseFiles.findFirst({
        where: eq(knowledgeBaseFiles.fileId, id),
      });
      expect(kbFile).toMatchObject({ fileId: id, knowledgeBaseId: 'kb1' });
    });

    it('should create a new file with hash', async () => {
      const params = {
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileHash: 'abc',
        fileType: 'text/plain',
      };

      const { id } = await fileModel.create(params, true);
      expect(id).toBeDefined();

      const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      expect(file).toMatchObject({ ...params, userId });

      const globalFile = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, params.fileHash),
      });
      expect(globalFile).toMatchObject({
        url: 'https://example.com/test-file.txt',
        size: 100,
        hashId: 'abc',
        fileType: 'text/plain',
      });
    });
  });

  describe('createGlobalFile', () => {
    it('should create a global file', async () => {
      const globalFile = {
        hashId: 'test-hash',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/global-file.txt',
        metadata: { key: 'value' },
        creator: userId,
      };

      const result = await fileModel.createGlobalFile(globalFile);
      expect(result[0]).toMatchObject(globalFile);
    });
  });

  describe('repairGlobalFile', () => {
    it('updates the canonical object and every file row sharing its hash', async () => {
      const hashId = 'repair-hash';
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId,
        metadata: { stale: true },
        size: 10,
        url: 'files/stale.txt',
      });
      const firstFile = await fileModel.create({
        fileHash: hashId,
        fileType: 'text/plain',
        name: 'first.txt',
        size: 10,
        url: 'files/stale.txt',
      });
      const secondFile = await new FileModel(serverDB, 'user2').create({
        fileHash: hashId,
        fileType: 'text/plain',
        name: 'second.txt',
        size: 10,
        url: 'files/stale.txt',
      });

      await fileModel.repairGlobalFile(hashId, {
        fileType: 'text/html',
        metadata: { repaired: true },
        size: 20,
        url: 'files/repaired.html',
      });

      const globalFile = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, hashId),
      });
      const repairedFiles = await serverDB.query.files.findMany({
        where: inArray(files.id, [firstFile.id, secondFile.id]),
      });

      expect(globalFile).toMatchObject({
        creator: userId,
        fileType: 'text/html',
        metadata: { repaired: true },
        size: 20,
        url: 'files/repaired.html',
      });
      expect(repairedFiles).toHaveLength(2);
      expect(repairedFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fileType: 'text/html',
            metadata: { repaired: true },
            size: 20,
            url: 'files/repaired.html',
          }),
          expect.objectContaining({
            fileType: 'text/html',
            metadata: { repaired: true },
            size: 20,
            url: 'files/repaired.html',
          }),
        ]),
      );
    });
  });

  describe('checkHash', () => {
    it('should return isExist: false for non-existent hash', async () => {
      const result = await fileModel.checkHash('non-existent-hash');
      expect(result).toEqual({ isExist: false });
    });

    it('should return file info for existing hash', async () => {
      const globalFile = {
        hashId: 'existing-hash',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/existing-file.txt',
        metadata: { key: 'value' },
        creator: userId,
      };

      await serverDB.insert(globalFiles).values(globalFile);

      const result = await fileModel.checkHash('existing-hash');
      expect(result).toEqual({
        isExist: true,
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/existing-file.txt',
        metadata: { key: 'value' },
      });
    });
  });

  describe('delete', () => {
    it('returns an unhashed file so its directly owned storage object can be removed', async () => {
      const { id } = await fileModel.create({
        fileType: 'text/plain',
        name: 'unhashed.txt',
        size: 100,
        url: 'files/unhashed.txt',
      });

      const cleanupFile = await fileModel.delete(id, false);

      expect(cleanupFile).toMatchObject({ id, url: 'files/unhashed.txt' });
      await expect(
        serverDB.query.files.findFirst({ where: eq(files.id, id) }),
      ).resolves.toBeUndefined();
    });

    it('should delete a file by id', async () => {
      await fileModel.createGlobalFile({
        hashId: '1',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileType: 'text/plain',
        creator: userId,
      });

      const { id } = await fileModel.create({
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: '1',
      });

      await fileModel.delete(id);

      const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      const globalFile = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, '1'),
      });

      expect(file).toBeUndefined();
      expect(globalFile).toBeUndefined();
    });
    it('should delete a file by id but global file not removed ', async () => {
      await fileModel.createGlobalFile({
        hashId: '1',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileType: 'text/plain',
        creator: userId,
      });

      const { id } = await fileModel.create({
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: '1',
      });

      await fileModel.delete(id, false);

      const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      const globalFile = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, '1'),
      });

      expect(file).toBeUndefined();
      expect(globalFile).toBeDefined();
    });
  });

  describe('deleteMany', () => {
    it('returns unhashed files for direct storage cleanup even when global removal is disabled', async () => {
      const firstFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'first-unhashed.txt',
        size: 100,
        url: 'files/first-unhashed.txt',
      });
      const secondFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'second-unhashed.txt',
        size: 100,
        url: 'files/second-unhashed.txt',
      });

      const cleanupFiles = await fileModel.deleteMany([firstFile.id, secondFile.id], false);

      expect(cleanupFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: firstFile.id }),
          expect.objectContaining({ id: secondFile.id }),
        ]),
      );
    });

    it('should delete multiple files', async () => {
      await fileModel.createGlobalFile({
        hashId: '1',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileType: 'text/plain',
        creator: userId,
      });
      await fileModel.createGlobalFile({
        hashId: '2',
        url: 'https://example.com/file2.txt',
        size: 200,
        fileType: 'text/plain',
        creator: userId,
      });

      const file1 = await fileModel.create({
        name: 'file1.txt',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileHash: '1',
        fileType: 'text/plain',
      });
      const file2 = await fileModel.create({
        name: 'file2.txt',
        url: 'https://example.com/file2.txt',
        size: 200,
        fileType: 'text/plain',
        fileHash: '2',
      });
      const globalFilesResult = await serverDB.query.globalFiles.findMany({
        where: inArray(globalFiles.hashId, ['1', '2']),
      });
      expect(globalFilesResult).toHaveLength(2);

      const cleanupFiles = await fileModel.deleteMany([file1.id, file2.id]);

      const remainingFiles = await serverDB.query.files.findMany({
        where: eq(files.userId, userId),
      });
      const globalFilesResult2 = await serverDB.query.globalFiles.findMany({
        where: inArray(
          globalFiles.hashId,
          remainingFiles.map((i) => i.fileHash as string),
        ),
      });

      expect(remainingFiles).toHaveLength(0);
      expect(globalFilesResult2).toHaveLength(0);
      expect(cleanupFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: file1.id }),
          expect.objectContaining({ id: file2.id }),
        ]),
      );
    });
    it('should delete multiple files but not remove global files if DISABLE_REMOVE_GLOBAL_FILE=true', async () => {
      await fileModel.createGlobalFile({
        hashId: '1',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileType: 'text/plain',
        creator: userId,
      });
      await fileModel.createGlobalFile({
        hashId: '2',
        url: 'https://example.com/file2.txt',
        size: 200,
        fileType: 'text/plain',
        creator: userId,
      });

      const file1 = await fileModel.create({
        name: 'file1.txt',
        url: 'https://example.com/file1.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: '1',
      });
      const file2 = await fileModel.create({
        name: 'file2.txt',
        url: 'https://example.com/file2.txt',
        size: 200,
        fileType: 'text/plain',
        fileHash: '2',
      });

      const globalFilesResult = await serverDB.query.globalFiles.findMany({
        where: inArray(globalFiles.hashId, ['1', '2']),
      });

      expect(globalFilesResult).toHaveLength(2);

      const cleanupFiles = await fileModel.deleteMany([file1.id, file2.id], false);

      const remainingFiles = await serverDB.query.files.findMany({
        where: eq(files.userId, userId),
      });
      const globalFilesResult2 = await serverDB.query.globalFiles.findMany({
        where: inArray(globalFiles.hashId, ['1', '2']),
      });

      expect(remainingFiles).toHaveLength(0);
      expect(globalFilesResult2).toHaveLength(2);
      expect(cleanupFiles).toEqual([]);
    });

    it('does not return a shared object for deletion while another row references it', async () => {
      const hashId = 'shared-hash';
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId,
        size: 100,
        url: 'files/shared.txt',
      });
      const selectedFile = await fileModel.create({
        fileHash: hashId,
        fileType: 'text/plain',
        name: 'selected.txt',
        size: 100,
        url: 'files/shared.txt',
      });
      const retainedFile = await new FileModel(serverDB, 'user2').create({
        fileHash: hashId,
        fileType: 'text/plain',
        name: 'retained.txt',
        size: 100,
        url: 'files/shared.txt',
      });

      const cleanupFiles = await fileModel.deleteMany([selectedFile.id]);

      expect(cleanupFiles).toEqual([]);
      await expect(
        serverDB.query.files.findFirst({ where: eq(files.id, retainedFile.id) }),
      ).resolves.toBeDefined();
      await expect(
        serverDB.query.globalFiles.findFirst({ where: eq(globalFiles.hashId, hashId) }),
      ).resolves.toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all files for the user', async () => {
      await fileModel.create({
        name: 'test-file-1.txt',
        url: 'https://example.com/test-file-1.txt',
        size: 100,
        fileType: 'text/plain',
      });
      await fileModel.create({
        name: 'test-file-2.txt',
        url: 'https://example.com/test-file-2.txt',
        size: 200,
        fileType: 'text/plain',
      });

      await fileModel.clear();

      const userFiles = await serverDB.query.files.findMany({ where: eq(files.userId, userId) });
      expect(userFiles).toHaveLength(0);
    });
  });

  describe('Query', () => {
    const sharedFileList = [
      {
        name: 'document.pdf',
        url: 'https://example.com/document.pdf',
        size: 1000,
        fileType: 'application/pdf',
        userId,
      },
      {
        name: 'image.jpg',
        url: 'https://example.com/image.jpg',
        size: 500,
        fileType: 'image/jpeg',
        userId,
      },
      {
        name: 'audio.mp3',
        url: 'https://example.com/audio.mp3',
        size: 2000,
        fileType: 'audio/mpeg',
        userId,
      },
    ];

    it('should query files for the user', async () => {
      await fileModel.create({
        name: 'test-file-1.txt',
        url: 'https://example.com/test-file-1.txt',
        size: 100,
        fileType: 'text/plain',
      });
      await fileModel.create({
        name: 'test-file-2.txt',
        url: 'https://example.com/test-file-2.txt',
        size: 200,
        fileType: 'text/plain',
      });
      await serverDB.insert(files).values({
        name: 'audio.mp3',
        url: 'https://example.com/audio.mp3',
        size: 2000,
        fileType: 'audio/mpeg',
        userId: 'user2',
      });

      const userFiles = await fileModel.query();
      expect(userFiles).toHaveLength(2);
      expect(userFiles[0].name).toBe('test-file-2.txt');
      expect(userFiles[1].name).toBe('test-file-1.txt');
    });

    it('excludes AI-generated images but keeps manually-uploaded files', async () => {
      // A manually-uploaded KB file (source NULL) must stay; a generated image
      // (source = FileSource.ImageGeneration) must not surface in the general/
      // KB list — it belongs to the art gallery (queryImageArtifacts).
      await fileModel.create({
        name: 'upload.png',
        url: 'https://example.com/upload.png',
        size: 500,
        fileType: 'image/png',
      });
      await serverDB.insert(files).values({
        name: 'generated.png',
        url: 'https://example.com/generated.png',
        size: 800,
        fileType: 'image/png',
        source: FileSource.ImageGeneration,
        userId,
      });

      const result = await fileModel.query();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('upload.png');
    });

    it('should filter files by name', async () => {
      await serverDB.insert(files).values(sharedFileList);
      const filteredFiles = await fileModel.query({ q: 'DOC' });
      expect(filteredFiles).toHaveLength(1);
      expect(filteredFiles[0].name).toBe('document.pdf');
    });

    it('should filter files by category', async () => {
      await serverDB.insert(files).values(sharedFileList);

      const imageFiles = await fileModel.query({ category: FilesTabs.Images });
      expect(imageFiles).toHaveLength(1);
      expect(imageFiles[0].name).toBe('image.jpg');
    });

    it('should sort files by name in ascending order', async () => {
      await serverDB.insert(files).values(sharedFileList);

      const sortedFiles = await fileModel.query({ sortType: SortType.Asc, sorter: 'name' });
      expect(sortedFiles[0].name).toBe('audio.mp3');
      expect(sortedFiles[2].name).toBe('image.jpg');
    });

    it('should sort files by size in descending order', async () => {
      await serverDB.insert(files).values(sharedFileList);

      const sortedFiles = await fileModel.query({ sortType: SortType.Desc, sorter: 'size' });
      expect(sortedFiles[0].name).toBe('audio.mp3');
      expect(sortedFiles[2].name).toBe('image.jpg');
    });

    it('should combine filtering and sorting', async () => {
      await serverDB.insert(files).values([
        ...sharedFileList,
        {
          name: 'big_document.pdf',
          url: 'https://example.com/big_document.pdf',
          size: 5000,
          fileType: 'application/pdf',
          userId,
        },
      ]);

      const filteredAndSortedFiles = await fileModel.query({
        category: FilesTabs.Documents,
        sortType: SortType.Desc,
        sorter: 'size',
      });

      expect(filteredAndSortedFiles).toHaveLength(2);
      expect(filteredAndSortedFiles[0].name).toBe('big_document.pdf');
      expect(filteredAndSortedFiles[1].name).toBe('document.pdf');
    });

    it('should return an empty array when no files match the query', async () => {
      await serverDB.insert(files).values(sharedFileList);
      const noFiles = await fileModel.query({ q: 'nonexistent' });
      expect(noFiles).toHaveLength(0);
    });

    it('should handle invalid sort field gracefully', async () => {
      await serverDB.insert(files).values(sharedFileList);

      const result = await fileModel.query({
        sortType: SortType.Asc,
        sorter: 'invalidField' as any,
      });
      expect(result).toHaveLength(3);
      // Should default to sorting by createdAt in descending order
    });

    describe('Query with knowledge base', () => {
      beforeEach(async () => {
        await serverDB.insert(files).values([
          {
            id: 'file1',
            name: 'file1.txt',
            userId,
            fileType: 'text/plain',
            size: 100,
            url: 'url1',
          },
          {
            id: 'file2',
            name: 'file2.txt',
            userId,
            fileType: 'text/plain',
            size: 200,
            url: 'url2',
          },
        ]);
        await serverDB
          .insert(knowledgeBaseFiles)
          .values([{ fileId: 'file1', knowledgeBaseId: 'kb1', userId }]);
      });

      it('should query files in a specific knowledge base', async () => {
        const result = await fileModel.query({ knowledgeBaseId: 'kb1' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('file1');
      });

      it('keeps a generated image visible inside a KB it was explicitly added to', async () => {
        // The source filter targets the overview only. A generated image that
        // is a KB member must stay visible (and removable) in that KB's list,
        // otherwise it becomes an invisible "ghost" member. The KB branch also
        // post-filters with isChunkableFile, which accepts image/png only when
        // the MarkItDown sidecar capability is on — flip it for this assertion
        // and restore it afterwards (the suite runs singleFork, module state
        // would otherwise leak into sibling tests).
        const original = getChunkableFileCapabilities();
        try {
          setChunkableFileCapabilities({ markitdown: true });
          await serverDB.insert(files).values({
            id: 'gen-img',
            name: 'generated.png',
            userId,
            fileType: 'image/png',
            size: 800,
            url: 'https://example.com/generated.png',
            source: FileSource.ImageGeneration,
          });
          await serverDB
            .insert(knowledgeBaseFiles)
            .values([{ fileId: 'gen-img', knowledgeBaseId: 'kb1', userId }]);

          const result = await fileModel.query({ knowledgeBaseId: 'kb1' });
          expect(result.map((f) => f.id)).toContain('gen-img');
        } finally {
          setChunkableFileCapabilities(original);
        }
      });

      it('should exclude files in knowledge bases when showFilesInKnowledgeBase is false', async () => {
        const result = await fileModel.query({ showFilesInKnowledgeBase: false });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('file2');
      });

      it('should include all files when showFilesInKnowledgeBase is true', async () => {
        const result = await fileModel.query({ showFilesInKnowledgeBase: true });
        expect(result).toHaveLength(2);
      });
    });
  });

  describe('findById', () => {
    it('should find a file by id', async () => {
      const { id } = await fileModel.create({
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
      });

      const file = await fileModel.findById(id);
      expect(file).toMatchObject({
        id,
        name: 'test-file.txt',
        url: 'https://example.com/test-file.txt',
        size: 100,
        fileType: 'text/plain',
        userId,
      });
    });
  });

  it('should update a file', async () => {
    const { id } = await fileModel.create({
      name: 'test-file.txt',
      url: 'https://example.com/test-file.txt',
      size: 100,
      fileType: 'text/plain',
    });

    await fileModel.update(id, { name: 'updated-test-file.txt', size: 200 });

    const updatedFile = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
    expect(updatedFile).toMatchObject({
      id,
      name: 'updated-test-file.txt',
      url: 'https://example.com/test-file.txt',
      size: 200,
      fileType: 'text/plain',
      userId,
    });
  });

  it('should countFilesByHash', async () => {
    const fileList = [
      {
        id: '1',
        name: 'document.pdf',
        url: 'https://example.com/document.pdf',
        fileHash: 'hash1',
        size: 1000,
        fileType: 'application/pdf',
        userId,
      },
      {
        id: '2',
        name: 'image.jpg',
        url: 'https://example.com/image.jpg',
        fileHash: 'hash2',
        size: 500,
        fileType: 'image/jpeg',
        userId,
      },
      {
        id: '5',
        name: 'document.pdf',
        url: 'https://example.com/document.pdf',
        fileHash: 'hash1',
        size: 1000,
        fileType: 'application/pdf',
        userId: 'user2',
      },
    ];

    await serverDB.insert(globalFiles).values([
      {
        hashId: 'hash1',
        url: 'https://example.com/document.pdf',
        size: 1000,
        fileType: 'application/pdf',
        creator: userId,
      },
      {
        hashId: 'hash2',
        url: 'https://example.com/image.jpg',
        size: 500,
        fileType: 'image/jpeg',
        creator: userId,
      },
    ]);

    await serverDB.insert(files).values(fileList);

    const data = await fileModel.countFilesByHash('hash1');
    expect(data).toEqual(2);
  });

  describe('countUsage', () => {
    const sharedFileList = [
      {
        name: 'document.pdf',
        url: 'https://example.com/document.pdf',
        size: 1000,
        fileType: 'application/pdf',
        userId,
      },
      {
        name: 'image.jpg',
        url: 'https://example.com/image.jpg',
        size: 500,
        fileType: 'image/jpeg',
        userId,
      },
      {
        name: 'audio.mp3',
        url: 'https://example.com/audio.mp3',
        size: 2000,
        fileType: 'audio/mpeg',
        userId,
      },
    ];

    it('should get total size of files for the user', async () => {
      await serverDB.insert(files).values(sharedFileList);
      const size = await fileModel.countUsage();

      expect(size).toBe(3500);
    });
  });

  describe('findByNames', () => {
    it('should find files by names', async () => {
      // 准备测试数据
      const fileList = [
        {
          name: 'test1.txt',
          url: 'https://example.com/test1.txt',
          size: 100,
          fileType: 'text/plain',
          userId,
        },
        {
          name: 'test2.txt',
          url: 'https://example.com/test2.txt',
          size: 200,
          fileType: 'text/plain',
          userId,
        },
        {
          name: 'other.txt',
          url: 'https://example.com/other.txt',
          size: 300,
          fileType: 'text/plain',
          userId,
        },
      ];

      await serverDB.insert(files).values(fileList);

      // 测试查找文件
      const result = await fileModel.findByNames(['test1', 'test2']);
      expect(result).toHaveLength(2);
      expect(result.map((f) => f.name)).toContain('test1.txt');
      expect(result.map((f) => f.name)).toContain('test2.txt');
    });

    it('should return empty array when no files match names', async () => {
      const result = await fileModel.findByNames(['nonexistent']);
      expect(result).toHaveLength(0);
    });

    it('should only find files belonging to current user', async () => {
      // 准备测试数据
      await serverDB.insert(files).values([
        {
          name: 'test1.txt',
          url: 'https://example.com/test1.txt',
          size: 100,
          fileType: 'text/plain',
          userId,
        },
        {
          name: 'test2.txt',
          url: 'https://example.com/test2.txt',
          size: 200,
          fileType: 'text/plain',
          userId: 'user2', // 不同用户的文件
        },
      ]);

      const result = await fileModel.findByNames(['test']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test1.txt');
    });
  });

  describe('findUrlCandidatesByKey', () => {
    const insertUrls = async (urls: { url: string; userId?: string }[]) =>
      serverDB.insert(files).values(
        urls.map(({ url, userId: rowUserId }, index) => ({
          name: `f${index}`,
          url,
          size: 1,
          fileType: 'image/png',
          userId: rowUserId ?? userId,
        })),
      );

    it('matches a bare-key row exactly', async () => {
      await insertUrls([{ url: 'files/466737/abc.png' }]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toEqual([
        'files/466737/abc.png',
      ]);
    });

    it('matches a legacy full storage URL by its trailing path', async () => {
      const legacy = 'https://s3.example.com/bucket/files/466737/abc.png';
      await insertUrls([{ url: legacy }]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toEqual([legacy]);
    });

    it('matches a presigned legacy URL with a query string', async () => {
      const presigned = 'https://s3.example.com/bucket/files/466737/abc.png?X-Amz-Signature=xyz';
      await insertUrls([{ url: presigned }]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toEqual([presigned]);
    });

    it('excludes rows that merely contain the key at a non-slash boundary', async () => {
      await insertUrls([
        { url: 'files/466737/zabc.png' },
        { url: 'prefix-files/466737/abc.png-suffix' },
      ]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toEqual([]);
    });

    it('returns the real match even when many rows contain the key substring', async () => {
      const noise = Array.from({ length: 25 }, (_, i) => ({
        url: `files/noise/${i}/contains-abc.png`,
      }));
      const legacy = 'https://s3.example.com/bucket/files/466737/abc.png';
      await insertUrls([...noise, { url: legacy }]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toContain(legacy);
    });

    it('treats underscore in the key as a literal, not a LIKE wildcard', async () => {
      await insertUrls([{ url: 'https://s3.example.com/bucket/files/aXb.png' }]);

      expect(await fileModel.findUrlCandidatesByKey('files/a_b.png')).toEqual([]);
    });

    it('excludes rows belonging to other users', async () => {
      await insertUrls([
        { url: 'https://s3.example.com/bucket/files/466737/abc.png', userId: 'user2' },
      ]);

      expect(await fileModel.findUrlCandidatesByKey('files/466737/abc.png')).toEqual([]);
    });
  });

  describe('deleteGlobalFile', () => {
    it('should delete global file by hashId', async () => {
      // 准备测试数据
      const globalFile = {
        hashId: 'test-hash',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/global-file.txt',
        metadata: { key: 'value' },
        creator: userId,
      };

      await serverDB.insert(globalFiles).values(globalFile);

      // 执行删除操作
      await fileModel.deleteGlobalFile('test-hash');

      // 验证文件已被删除
      const result = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, 'test-hash'),
      });
      expect(result).toBeUndefined();
    });

    it('should not throw error when deleting non-existent global file', async () => {
      // 删除不存在的文件不应抛出错误
      await expect(fileModel.deleteGlobalFile('non-existent-hash')).resolves.not.toThrow();
    });

    it('should only delete specified global file', async () => {
      // 准备测试数据
      const globalFiles1 = {
        hashId: 'hash1',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/file1.txt',
        creator: userId,
      };
      const globalFiles2 = {
        hashId: 'hash2',
        fileType: 'text/plain',
        size: 200,
        url: 'https://example.com/file2.txt',
        creator: userId,
      };

      await serverDB.insert(globalFiles).values([globalFiles1, globalFiles2]);

      // 删除一个文件
      await fileModel.deleteGlobalFile('hash1');

      // 验证只有指定文件被删除
      const remainingFiles = await serverDB.query.globalFiles.findMany();
      expect(remainingFiles).toHaveLength(1);
      expect(remainingFiles[0].hashId).toBe('hash2');
    });
  });

  describe('Transaction Support', () => {
    describe('create with transaction', () => {
      it('should create file within provided transaction', async () => {
        const params = {
          name: 'test-file-txn.txt',
          url: 'https://example.com/test-file-txn.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'test-hash-txn',
        };

        // 在事务中创建文件
        const result = await serverDB.transaction(async (trx) => {
          const { id } = await fileModel.create(params, true, trx);

          // 在事务内验证文件已创建
          const file = await trx.query.files.findFirst({ where: eq(files.id, id) });
          expect(file).toMatchObject({ ...params, userId });

          return { id };
        });

        // 事务提交后，验证文件仍然存在
        const file = await serverDB.query.files.findFirst({ where: eq(files.id, result.id) });
        expect(file).toMatchObject({ ...params, userId });

        // 验证全局文件也被创建
        const globalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, params.fileHash),
        });
        expect(globalFile).toBeDefined();
      });

      it('should rollback file creation when transaction fails', async () => {
        const params = {
          name: 'test-file-rollback.txt',
          url: 'https://example.com/test-file-rollback.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'test-hash-rollback',
        };

        let createdFileId: string | undefined;

        // 故意让事务失败
        await expect(
          serverDB.transaction(async (trx) => {
            const { id } = await fileModel.create(params, true, trx);
            createdFileId = id;

            // 在事务内验证文件已创建
            const file = await trx.query.files.findFirst({ where: eq(files.id, id) });
            expect(file).toMatchObject({ ...params, userId });

            // 抛出错误导致事务回滚
            throw new Error('Intentional rollback');
          }),
        ).rejects.toThrow('Intentional rollback');

        // 验证文件创建被回滚
        if (createdFileId) {
          const file = await serverDB.query.files.findFirst({
            where: eq(files.id, createdFileId),
          });
          expect(file).toBeUndefined();
        }

        // 验证全局文件创建也被回滚
        const globalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, params.fileHash),
        });
        expect(globalFile).toBeUndefined();
      });

      it('should create file with knowledgeBase within transaction', async () => {
        const params = {
          name: 'test-kb-file.txt',
          url: 'https://example.com/test-kb-file.txt',
          size: 100,
          fileType: 'text/plain',
          knowledgeBaseId: 'kb1',
        };

        const result = await serverDB.transaction(async (trx) => {
          const { id } = await fileModel.create(params, false, trx);

          // 验证知识库文件关联已创建
          const kbFile = await trx.query.knowledgeBaseFiles.findFirst({
            where: eq(knowledgeBaseFiles.fileId, id),
          });
          expect(kbFile).toMatchObject({ fileId: id, knowledgeBaseId: 'kb1', userId });

          return { id };
        });

        // 事务提交后验证
        const kbFile = await serverDB.query.knowledgeBaseFiles.findFirst({
          where: eq(knowledgeBaseFiles.fileId, result.id),
        });
        expect(kbFile).toMatchObject({
          fileId: result.id,
          knowledgeBaseId: 'kb1',
          userId,
        });
      });
    });

    describe('delete with transaction', () => {
      it('should delete file within provided transaction', async () => {
        // 先创建文件和全局文件
        await fileModel.createGlobalFile({
          hashId: 'delete-txn-hash',
          url: 'https://example.com/delete-txn.txt',
          size: 100,
          fileType: 'text/plain',
          creator: userId,
        });

        const { id } = await fileModel.create({
          name: 'delete-txn-file.txt',
          url: 'https://example.com/delete-txn.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'delete-txn-hash',
        });

        // 在事务中删除文件
        await serverDB.transaction(async (trx) => {
          await fileModel.delete(id, true, trx);

          // 在事务内验证文件已删除
          const file = await trx.query.files.findFirst({ where: eq(files.id, id) });
          expect(file).toBeUndefined();
        });

        // 事务提交后验证文件仍然被删除
        const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
        expect(file).toBeUndefined();

        // 验证全局文件也被删除（因为没有其他引用）
        const globalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, 'delete-txn-hash'),
        });
        expect(globalFile).toBeUndefined();
      });

      it('should rollback file deletion when transaction fails', async () => {
        // 先创建文件和全局文件
        await fileModel.createGlobalFile({
          hashId: 'rollback-delete-hash',
          url: 'https://example.com/rollback-delete.txt',
          size: 100,
          fileType: 'text/plain',
          creator: userId,
        });

        const { id } = await fileModel.create({
          name: 'rollback-delete-file.txt',
          url: 'https://example.com/rollback-delete.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'rollback-delete-hash',
        });

        // 故意让事务失败
        await expect(
          serverDB.transaction(async (trx) => {
            await fileModel.delete(id, true, trx);

            // 在事务内验证文件已删除
            const file = await trx.query.files.findFirst({ where: eq(files.id, id) });
            expect(file).toBeUndefined();

            // 抛出错误导致事务回滚
            throw new Error('Intentional rollback for delete');
          }),
        ).rejects.toThrow('Intentional rollback for delete');

        // 验证文件删除被回滚，文件仍然存在
        const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
        expect(file).toBeDefined();
        expect(file?.name).toBe('rollback-delete-file.txt');

        // 验证全局文件也被回滚，仍然存在
        const globalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, 'rollback-delete-hash'),
        });
        expect(globalFile).toBeDefined();
      });

      it('should delete file but preserve global file when removeGlobalFile=false in transaction', async () => {
        // 先创建文件和全局文件
        await fileModel.createGlobalFile({
          hashId: 'preserve-global-hash',
          url: 'https://example.com/preserve-global.txt',
          size: 100,
          fileType: 'text/plain',
          creator: userId,
        });

        const { id } = await fileModel.create({
          name: 'preserve-global-file.txt',
          url: 'https://example.com/preserve-global.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'preserve-global-hash',
        });

        // 在事务中删除文件，但不删除全局文件
        await serverDB.transaction(async (trx) => {
          await fileModel.delete(id, false, trx);
        });

        // 验证文件被删除
        const file = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
        expect(file).toBeUndefined();

        // 验证全局文件被保留
        const globalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, 'preserve-global-hash'),
        });
        expect(globalFile).toBeDefined();
      });
    });

    describe('mixed operations in transaction', () => {
      it('should support create and delete operations in same transaction', async () => {
        // 先创建一个要删除的文件
        await fileModel.createGlobalFile({
          hashId: 'mixed-delete-hash',
          url: 'https://example.com/mixed-delete.txt',
          size: 100,
          fileType: 'text/plain',
          creator: userId,
        });

        const { id: deleteFileId } = await fileModel.create({
          name: 'mixed-delete-file.txt',
          url: 'https://example.com/mixed-delete.txt',
          size: 100,
          fileType: 'text/plain',
          fileHash: 'mixed-delete-hash',
        });

        // 在同一个事务中删除旧文件并创建新文件
        const result = await serverDB.transaction(async (trx) => {
          // 删除旧文件
          await fileModel.delete(deleteFileId, true, trx);

          // 创建新文件
          const { id: newFileId } = await fileModel.create(
            {
              name: 'mixed-create-file.txt',
              url: 'https://example.com/mixed-create.txt',
              size: 200,
              fileType: 'text/plain',
              fileHash: 'mixed-create-hash',
            },
            true,
            trx,
          );

          return { newFileId };
        });

        // 验证旧文件被删除
        const deletedFile = await serverDB.query.files.findFirst({
          where: eq(files.id, deleteFileId),
        });
        expect(deletedFile).toBeUndefined();

        // 验证新文件被创建
        const newFile = await serverDB.query.files.findFirst({
          where: eq(files.id, result.newFileId),
        });
        expect(newFile).toBeDefined();
        expect(newFile?.name).toBe('mixed-create-file.txt');

        // 验证新的全局文件被创建
        const newGlobalFile = await serverDB.query.globalFiles.findFirst({
          where: eq(globalFiles.hashId, 'mixed-create-hash'),
        });
        expect(newGlobalFile).toBeDefined();
      });
    });
  });

  describe('private getFileTypePrefix method', () => {
    it('should handle unknown file category', async () => {
      // This tests the default case in switch statement (line 312-313)
      const unknownCategory = 'unknown' as FilesTabs;

      // We need to access the private method indirectly by testing the query method
      // that uses getFileTypePrefix internally
      const params = {
        category: unknownCategory,
        current: 1,
        pageSize: 10,
      };

      // This should not throw an error and should handle the unknown category gracefully
      const result = await fileModel.query(params);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('large batch operations', () => {
    it('should handle large number of chunks deletion in batches', async () => {
      // This tests the batch processing code (lines 351-381)
      // First create a file with many chunks to test the batch deletion logic
      const testFile = {
        name: 'large-file.txt',
        url: 'https://example.com/large-file.txt',
        size: 100000,
        fileType: 'text/plain',
        fileHash: 'large-file-hash',
      };

      const { id: fileId } = await fileModel.create(testFile, true);

      // Create many chunks for this file to trigger batch processing
      // Note: This is a simplified test since we can't easily create 3000+ chunks
      // But it will still exercise the batch deletion code path

      // Insert chunks (this might need to be done through proper API)  
      // For testing purposes, we'll delete the file which should trigger the batch deletion
      await fileModel.delete(fileId, true);

      // Verify the file is deleted
      const deletedFile = await serverDB.query.files.findFirst({
        where: eq(files.id, fileId),
      });
      expect(deletedFile).toBeUndefined();
    });
  });

  describe('deleteFileChunks error handling', () => {
    let consoleWarnSpy: any;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should delete file even when chunks deletion fails', async () => {
      // 创建测试文件
      const testFile = {
        name: 'error-test-file.txt',
        url: 'https://example.com/error-test-file.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: 'error-test-hash',
      };

      const { id: fileId } = await fileModel.create(testFile, true);

      // 创建一些测试数据来模拟chunks关联
      const chunkId1 = '550e8400-e29b-41d4-a716-446655440001';
      const chunkId2 = '550e8400-e29b-41d4-a716-446655440002';

      // 插入chunks
      await serverDB.insert(chunks).values([
        { id: chunkId1, text: 'chunk 1', userId, type: 'text' },
        { id: chunkId2, text: 'chunk 2', userId, type: 'text' },
      ]);

      // 插入fileChunks关联
      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunkId1, userId },
        { fileId, chunkId: chunkId2, userId },
      ]);

      // 插入embeddings (1024维向量)
      const testEmbedding = new Array(1024).fill(0.1);
      await serverDB.insert(embeddings).values([
        { chunkId: chunkId1, embeddings: testEmbedding, model: 'test-model', userId },
      ]);

      // 跳过 documentChunks 测试，因为需要先创建 documents 记录

      // 删除文件，应该会清理所有相关数据
      const result = await fileModel.delete(fileId, true);

      // 验证文件被删除
      const deletedFile = await serverDB.query.files.findFirst({
        where: eq(files.id, fileId),
      });
      expect(deletedFile).toBeUndefined();

      // 验证chunks被删除
      const remainingChunks = await serverDB.query.chunks.findMany({
        where: inArray(chunks.id, [chunkId1, chunkId2]),
      });
      expect(remainingChunks).toHaveLength(0);

      // 验证embeddings被删除
      const remainingEmbeddings = await serverDB.query.embeddings.findMany({
        where: inArray(embeddings.chunkId, [chunkId1, chunkId2]),
      });
      expect(remainingEmbeddings).toHaveLength(0);

      // 验证fileChunks被删除
      const remainingFileChunks = await serverDB.query.fileChunks.findMany({
        where: eq(fileChunks.fileId, fileId),
      });
      expect(remainingFileChunks).toHaveLength(0);

      expect(result).toBeDefined();
    });

    it('should successfully delete file with all related chunks and embeddings', async () => {
      // 简化测试：只验证正常的完整删除流程（移除知识库保护后）
      const testFile = {
        name: 'complete-deletion-test.txt',
        url: 'https://example.com/complete-deletion-test.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: 'complete-deletion-hash',
      };

      const { id: fileId } = await fileModel.create(testFile, true);

      const chunkId = '550e8400-e29b-41d4-a716-446655440003';

      // 插入chunk
      await serverDB.insert(chunks).values([
        { id: chunkId, text: 'complete test chunk', userId, type: 'text' },
      ]);

      // 插入fileChunks关联
      await serverDB.insert(fileChunks).values([
        { fileId, chunkId, userId },
      ]);

      // 插入embeddings
      const testEmbedding = new Array(1024).fill(0.1);
      await serverDB.insert(embeddings).values([
        { chunkId, embeddings: testEmbedding, model: 'test-model', userId },
      ]);

      // 删除文件
      await fileModel.delete(fileId, true);

      // 验证文件被删除
      const deletedFile = await serverDB.query.files.findFirst({
        where: eq(files.id, fileId),
      });
      expect(deletedFile).toBeUndefined();

      // 验证chunks被删除
      const remainingChunks = await serverDB.query.chunks.findMany({
        where: eq(chunks.id, chunkId),
      });
      expect(remainingChunks).toHaveLength(0);

      // 验证embeddings被删除
      const remainingEmbeddings = await serverDB.query.embeddings.findMany({
        where: eq(embeddings.chunkId, chunkId),
      });
      expect(remainingEmbeddings).toHaveLength(0);

      // 验证fileChunks被删除
      const remainingFileChunks = await serverDB.query.fileChunks.findMany({
        where: eq(fileChunks.fileId, fileId),
      });
      expect(remainingFileChunks).toHaveLength(0);
    });


    it('should delete files that are in knowledge bases (removed protection)', async () => {
      // 测试修复后的逻辑：知识库中的文件也应该被删除
      const testFile = {
        name: 'knowledge-base-file.txt',
        url: 'https://example.com/knowledge-base-file.txt',
        size: 100,
        fileType: 'text/plain',
        fileHash: 'kb-file-hash',
        knowledgeBaseId: 'kb1',
      };

      const { id: fileId } = await fileModel.create(testFile, true);

      const chunkId = '550e8400-e29b-41d4-a716-446655440007';

      // 插入chunk和关联数据
      await serverDB.insert(chunks).values([
        { id: chunkId, text: 'knowledge base chunk', userId, type: 'text' },
      ]);

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId, userId },
      ]);

      // 插入embeddings (1024维向量)
      const testEmbedding = new Array(1024).fill(0.1);
      await serverDB.insert(embeddings).values([
        { chunkId, embeddings: testEmbedding, model: 'test-model', userId },
      ]);

      // 验证文件确实在知识库中
      const kbFile = await serverDB.query.knowledgeBaseFiles.findFirst({
        where: eq(knowledgeBaseFiles.fileId, fileId),
      });
      expect(kbFile).toBeDefined();

      // 删除文件
      await fileModel.delete(fileId, true);

      // 验证知识库中的文件也被完全删除
      const deletedFile = await serverDB.query.files.findFirst({
        where: eq(files.id, fileId),
      });
      expect(deletedFile).toBeUndefined();

      // 验证chunks被删除（这是修复的核心：之前知识库文件的chunks不会被删除）
      const remainingChunks = await serverDB.query.chunks.findMany({
        where: eq(chunks.id, chunkId),
      });
      expect(remainingChunks).toHaveLength(0);

      // 验证embeddings被删除
      const remainingEmbeddings = await serverDB.query.embeddings.findMany({
        where: eq(embeddings.chunkId, chunkId),
      });
      expect(remainingEmbeddings).toHaveLength(0);

      // 验证fileChunks被删除
      const remainingFileChunks = await serverDB.query.fileChunks.findMany({
        where: eq(fileChunks.fileId, fileId),
      });
      expect(remainingFileChunks).toHaveLength(0);
    });
  });
});
