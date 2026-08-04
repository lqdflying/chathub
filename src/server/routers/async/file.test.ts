// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import { ChunkService } from '@/server/services/chunk';
import { FileService } from '@/server/services/file';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { fileRouter } from './file';

const mocks = vi.hoisted(() => ({
  asyncTaskModel: {
    findById: vi.fn(),
    update: vi.fn(),
  },
  chunkModel: {},
  chunkService: {},
  embeddingModel: {},
  fileModel: {
    delete: vi.fn(),
    findById: vi.fn(),
  },
  fileService: {
    getFileByteArray: vi.fn(),
  },
  serverDB: {},
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: { KEY_VAULTS_SECRET: 'test-internal-secret' },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mocks.serverDB),
}));

vi.mock('@/database/models/asyncTask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/database/models/asyncTask')>();
  return { ...actual, AsyncTaskModel: vi.fn() };
});
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/user');
vi.mock('@/envs/file', () => ({ fileEnv: { CHUNKS_AUTO_EMBEDDING: false } }));
vi.mock('@/server/services/chunk', () => ({ ChunkService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/rag', () => ({
  RagEmbeddingService: vi.fn(),
  RagProviderNotConfiguredError: class extends Error {},
  resolveRagEmbeddingConfig: vi.fn(),
}));

describe('async fileRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(UserModel.findById).mockResolvedValue({ id: 'test-user' } as never);
    vi.mocked(AsyncTaskModel).mockImplementation(() => mocks.asyncTaskModel as never);
    vi.mocked(ChunkModel).mockImplementation(() => mocks.chunkModel as never);
    vi.mocked(ChunkService).mockImplementation(() => mocks.chunkService as never);
    vi.mocked(EmbeddingModel).mockImplementation(() => mocks.embeddingModel as never);
    vi.mocked(FileModel).mockImplementation(() => mocks.fileModel as never);
    vi.mocked(FileService).mockImplementation(() => mocks.fileService as never);

    mocks.fileModel.findById.mockResolvedValue({
      fileType: 'text/plain',
      id: 'file-1',
      name: 'document.txt',
      url: 'files/test-user/document.txt',
    });
    mocks.asyncTaskModel.findById.mockResolvedValue({ id: 'task-1' });
  });

  it('records a recoverable task error without deleting the file row when storage is missing', async () => {
    mocks.fileService.getFileByteArray.mockRejectedValue(
      Object.assign(new Error('The specified key does not exist.'), {
        Code: 'NoSuchKey',
        name: 'NoSuchKey',
      }),
    );
    const caller = fileRouter.createCaller({
      jwtPayload: {},
      secret: 'test-internal-secret',
      userId: 'test-user',
    });

    const result = await caller.parseFileToChunks({ fileId: 'file-1', taskId: 'task-1' });

    expect(result).toMatchObject({ success: false });
    expect(mocks.fileModel.delete).not.toHaveBeenCalled();
    expect(mocks.asyncTaskModel.update).toHaveBeenCalledWith('task-1', {
      error: {
        body: {
          detail: expect.stringContaining('Re-upload it to restore this document'),
        },
        name: AsyncTaskErrorType.ServerError,
      },
      status: AsyncTaskStatus.Error,
    });
  });
});
