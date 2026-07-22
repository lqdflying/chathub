import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataImporterRepos } from '@/database/repositories/dataImporter';
import { ImportResultData } from '@/types/importer';

import { importerRouter } from '../importer';

const mockGetFileContent = vi.fn();
const mockDeleteFile = vi.fn();
const mockImportData = vi.fn();
const mockImportPgData = vi.fn();
const mockTransaction = { transaction: 'conversation-write' };
const mockWithConversationWriteLockOrThrow = vi.fn();

vi.mock('@/database/repositories/dataImporter', () => ({
  DataImporterRepos: vi.fn().mockImplementation(() => ({
    importData: mockImportData,
    importPgData: mockImportPgData,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    deleteFile: mockDeleteFile,
    getFileContent: mockGetFileContent,
  })),
}));
vi.mock('@/server/services/conversationWriteLock', () => ({
  withConversationWriteLockOrThrow: (...args: unknown[]) =>
    mockWithConversationWriteLockOrThrow(...args),
}));

describe('importerRouter', () => {
  const mockFileContent = JSON.stringify({
    messages: [],
    version: 1,
  });

  const mockPgData = {
    data: {},
    mode: 'pglite' as const,
    schemaHash: 'hash',
  };

  const mockImportResult: ImportResultData = {
    results: { messages: { added: 1, errors: 0, skips: 0 } },
    success: true,
  };

  const mockImportErrorResult: ImportResultData = {
    error: {
      details: 'Error details',
      message: 'Import failed',
    },
    results: {},
    success: false,
  };

  beforeEach(() => {
    mockGetFileContent.mockResolvedValue(mockFileContent);
    mockImportData.mockResolvedValue(mockImportResult);
    mockImportPgData.mockResolvedValue(mockImportResult);
    mockWithConversationWriteLockOrThrow.mockImplementation(
      async (
        _database: unknown,
        _userId: string,
        callback: (transaction: unknown) => Promise<unknown>,
      ) => callback(mockTransaction),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const ctx = {
    serverDB: {} as any,
    userId: 'user-1',
  };

  describe('importByFile', () => {
    it('should successfully import file data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({
        expectedConversationVersion: 7,
        pathname: 'test.json',
      });

      expect(result).toEqual(mockImportResult);
      expect(mockGetFileContent).toHaveBeenCalledWith('test.json');
      expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
        ctx.serverDB,
        ctx.userId,
        expect.any(Function),
        7,
      );
      expect(DataImporterRepos).toHaveBeenCalledWith(mockTransaction, ctx.userId);
      expect(mockImportData).toHaveBeenCalledWith(JSON.parse(mockFileContent));
      expect(mockDeleteFile).toHaveBeenCalledWith('test.json');
    });

    it('should handle PG data import', async () => {
      mockGetFileContent.mockResolvedValue(JSON.stringify(mockPgData));

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({ pathname: 'test.json' });

      expect(result).toEqual(mockImportResult);
      expect(DataImporterRepos).toHaveBeenCalledWith(mockTransaction, ctx.userId);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
    });

    it('should throw error when file read fails', async () => {
      mockGetFileContent.mockRejectedValue(new Error('File read error'));

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });

    it('should throw error for invalid JSON', async () => {
      mockGetFileContent.mockResolvedValue('invalid json');

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });
  });

  describe('importByPost', () => {
    it('should successfully import posted data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const postData = {
        data: {
          messages: [],
          version: 1,
        },
        expectedConversationVersion: 7,
      };

      const result = await caller.importByPost(postData);

      expect(result).toEqual(mockImportResult);
      expect(DataImporterRepos).toHaveBeenCalledWith(mockTransaction, ctx.userId);
      expect(mockImportData).toHaveBeenCalledWith(postData.data);
      expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
        ctx.serverDB,
        ctx.userId,
        expect.any(Function),
        7,
      );
    });

    it('should handle import failure', async () => {
      mockImportData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByPost({
        data: {
          messages: [],
          version: 1,
        },
      });

      expect(result).toEqual(mockImportErrorResult);
    });
  });

  describe('importPgByPost', () => {
    it('should successfully import PG data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost({
        ...mockPgData,
        expectedConversationVersion: 7,
      });

      expect(result).toEqual(mockImportResult);
      expect(DataImporterRepos).toHaveBeenCalledWith(mockTransaction, ctx.userId);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
      expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
        ctx.serverDB,
        ctx.userId,
        expect.any(Function),
        7,
      );
    });

    it('should handle import failure', async () => {
      mockImportPgData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost(mockPgData);

      expect(result).toEqual(mockImportErrorResult);
    });
  });
});
