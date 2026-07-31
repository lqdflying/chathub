import { TRPCError } from '@trpc/server';
import { sha256 } from 'js-sha256';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import { fileRouter } from '@/server/routers/lambda/file';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

const TEST_HASH = 'a'.repeat(64);

// Patch: Use actual router context middleware to inject the correct models/services
function createCallerWithCtx(partialCtx: any = {}) {
  // All mocks are spies
  const fileModel = {
    checkHash: vi.fn().mockResolvedValue({
      fileType: 'image/png',
      isExist: true,
      metadata: { canonical: true },
      size: 321,
      url: 'files/canonical/file.png',
    }),
    create: vi.fn().mockResolvedValue({ id: 'test-id' }),
    findById: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue({} as any),
    findUrlCandidatesByKey: vi.fn().mockResolvedValue([]),
  };

  const fileService = {
    getFullFileUrl: vi.fn().mockResolvedValue('full-url'),
    getKeyFromFullUrl: vi.fn(),
    getUIFileUrl: vi.fn().mockResolvedValue('ui-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  };

  const chunkModel = {
    countByFileIds: vi.fn().mockResolvedValue([{ id: 'test-id', count: 5 }]),
    countByFileId: vi.fn().mockResolvedValue(5),
  };

  const asyncTaskModel = {
    findByIds: vi.fn().mockResolvedValue([
      {
        id: 'test-task-id',
        status: AsyncTaskStatus.Success,
      },
    ]),
    findById: vi.fn(),
    delete: vi.fn(),
  };

  const ctx = {
    serverDB: {} as any,
    userId: 'test-user',
    asyncTaskModel,
    chunkModel,
    fileModel,
    fileService,
    ...partialCtx,
  };

  vi.mocked(FileService).mockImplementation(() => fileService as never);
  vi.mocked(FileModel).mockImplementation(() => fileModel as never);

  return { ctx, caller: fileRouter.createCaller(ctx) };
}

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    REMOVE_GLOBAL_FILE: false,
  },
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    findById: vi.fn(),
    findByIds: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: vi.fn(() => ({
    countByFileId: vi.fn(),
    countByFileIds: vi.fn(),
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findById: vi.fn(),
    query: vi.fn(),
    clear: vi.fn(),
    findUrlCandidatesByKey: vi.fn(),
  })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://chat.example.com',
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    getFullFileUrl: vi.fn(),
    getKeyFromFullUrl: vi.fn(),
    getUIFileUrl: vi.fn(),
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
  })),
}));

describe('fileRouter', () => {
  let ctx: any;
  let caller: any;
  let mockFile: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFile = {
      id: 'test-id',
      name: 'test.txt',
      url: 'test-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      accessedAt: new Date(),
      userId: 'test-user',
      size: 100,
      fileType: 'text',
      metadata: {},
      fileHash: null,
      clientId: null,
      chunkTaskId: null,
      embeddingTaskId: null,
    };

    // Use actual context with default mocks
    ({ ctx, caller } = createCallerWithCtx());
  });

  describe('checkFileHash', () => {
    it('should handle when fileModel.checkHash returns undefined', async () => {
      ctx.fileModel.checkHash.mockResolvedValue(undefined);
      await expect(caller.checkFileHash({ hash: 'test-hash' })).resolves.toBeUndefined();
    });
  });

  describe('createFile', () => {
    it('should throw if fileModel.checkHash returns undefined', async () => {
      ctx.fileModel.checkHash.mockResolvedValue(undefined);
      await expect(
        caller.createFile({
          hash: TEST_HASH,
          fileType: 'text',
          name: 'test.txt',
          size: 100,
          url: 'test-url',
          metadata: {},
        }),
      ).rejects.toThrow();
    });

    const createFileWithUrl = (url: string) =>
      caller.createFile({
        hash: TEST_HASH,
        fileType: 'image/png',
        name: 'test.png',
        size: 100,
        url,
        metadata: {},
      });

    it.each(['../secret.png', 'a/../b.png', '/abs/path.png', 'a\u0000b.png', 'a\\b.png'])(
      'rejects a traversal-shaped or control-char url %j',
      async (url) => {
        await expect(createFileWithUrl(url)).rejects.toThrow();
        expect(ctx.fileModel.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      `files/${sha256('test-user')}/466737/uuid.png`,
      'desktop://documents/x.png',
    ])(
      'accepts a current-user scoped key or desktop url %j',
      async (url) => {
        ctx.fileModel.checkHash.mockResolvedValue({ isExist: false });

        await expect(createFileWithUrl(url)).resolves.toEqual({ id: 'test-id', url: 'ui-url' });
        expect(ctx.fileModel.create).toHaveBeenCalledWith(
          expect.objectContaining({ url }),
          true,
        );
      },
    );

    it('uses the canonical global-file values for an existing hash', async () => {
      await expect(createFileWithUrl('files/victim/known-key.png')).resolves.toEqual({
        id: 'test-id',
        url: 'ui-url',
      });

      expect(ctx.fileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileHash: TEST_HASH,
          fileType: 'image/png',
          metadata: { canonical: true },
          size: 321,
          url: 'files/canonical/file.png',
        }),
        false,
      );
      expect(ctx.fileService.getUIFileUrl).toHaveBeenCalledWith('files/canonical/file.png');
    });

    it('rejects a foreign or legacy key for a new hash', async () => {
      ctx.fileModel.checkHash.mockResolvedValue({ isExist: false });

      await expect(createFileWithUrl('files/466737/uuid.png')).rejects.toThrow(
        'invalid file url',
      );
      await expect(
        createFileWithUrl(`files/${sha256('other-user')}/466737/uuid.png`),
      ).rejects.toThrow('invalid file url');
      expect(ctx.fileModel.create).not.toHaveBeenCalled();
    });

    it.each([
      'generations/images/other.png',
      'user/avatar/victim/a.png',
      'https://storage.example.com/generations/images/other.png',
    ])('rejects a key in a server-only namespace %j', async (url) => {
      ctx.fileModel.checkHash.mockResolvedValue({ isExist: false });

      await expect(createFileWithUrl(url)).rejects.toThrow('invalid file url');
      expect(ctx.fileModel.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should throw error when file not found', async () => {
      ctx.fileModel.findById.mockResolvedValue(null);

      await expect(caller.findById({ id: 'invalid-id' })).rejects.toThrow(TRPCError);
    });
  });

  describe('getFileItemById', () => {
    it('should throw error when file not found', async () => {
      ctx.fileModel.findById.mockResolvedValue(null);

      await expect(caller.getFileItemById({ id: 'invalid-id' })).rejects.toThrow(TRPCError);
    });
  });

  describe('getFiles', () => {
    it('should handle fileModel.query returning undefined', async () => {
      ctx.fileModel.query.mockResolvedValue(undefined);

      await expect(caller.getFiles({})).rejects.toThrow();
    });
  });

  describe('removeFile', () => {
    it('should do nothing when file not found', async () => {
      ctx.fileModel.delete.mockResolvedValue(null);

      await caller.removeFile({ id: 'invalid-id' });

      expect(ctx.fileService.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('should do nothing when no files found', async () => {
      ctx.fileModel.deleteMany.mockResolvedValue([]);

      await caller.removeFiles({ ids: ['invalid-1', 'invalid-2'] });

      expect(ctx.fileService.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('removeFileAsyncTask', () => {
    it('should do nothing when file not found', async () => {
      ctx.fileModel.findById.mockResolvedValue(null);

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'chunk' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();
    });

    it('should do nothing when task id is missing', async () => {
      ctx.fileModel.findById.mockResolvedValue(mockFile);

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'embedding' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'chunk' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();
    });
  });

  describe('resolvePublicUrl', () => {
    it('resolves same-origin app-proxy URLs owned by the user via their bare key', async () => {
      ctx.fileModel.findUrlCandidatesByKey.mockResolvedValue(['references/image.png']);
      ctx.fileService.getFullFileUrl.mockResolvedValue('https://storage.example.com/signed.png');

      await expect(
        caller.resolvePublicUrl({
          url: 'https://chat.example.com/webapi/files/references/image.png',
        }),
      ).resolves.toBe('https://storage.example.com/signed.png');

      expect(ctx.fileModel.findUrlCandidatesByKey).toHaveBeenCalledWith('references/image.png');
      expect(ctx.fileService.getFullFileUrl).toHaveBeenCalledWith('references/image.png');
    });

    it('resolves keys stored as legacy full URLs', async () => {
      const legacyUrl = 'https://s3.example.com/bucket/references/image.png';
      ctx.fileModel.findUrlCandidatesByKey.mockResolvedValue([legacyUrl]);
      ctx.fileService.getKeyFromFullUrl.mockReturnValue('references/image.png');
      ctx.fileService.getFullFileUrl.mockResolvedValue('https://storage.example.com/signed.png');

      await expect(
        caller.resolvePublicUrl({
          url: 'https://chat.example.com/webapi/files/references/image.png',
        }),
      ).resolves.toBe('https://storage.example.com/signed.png');

      expect(ctx.fileService.getKeyFromFullUrl).toHaveBeenCalledWith(legacyUrl);
    });

    it('rejects keys not owned by the requesting user with NOT_FOUND', async () => {
      ctx.fileModel.findUrlCandidatesByKey.mockResolvedValue([]);

      await expect(
        caller.resolvePublicUrl({
          url: 'https://chat.example.com/webapi/files/references/image.png',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
    });

    it('rejects when candidate rows do not confirm the requested key', async () => {
      ctx.fileModel.findUrlCandidatesByKey.mockResolvedValue([
        'https://s3.example.com/bucket/other/key.png',
      ]);
      ctx.fileService.getKeyFromFullUrl.mockReturnValue('other/key.png');

      await expect(
        caller.resolvePublicUrl({
          url: 'https://chat.example.com/webapi/files/references/image.png',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
    });

    it('does not resolve foreign storage URLs that collide with the proxy path', async () => {
      const storageUrl = 'https://storage.example.com/webapi/files/references/image.png';

      await expect(caller.resolvePublicUrl({ url: storageUrl })).resolves.toBe(storageUrl);

      expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
    });
  });
});
