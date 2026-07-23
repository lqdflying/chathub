import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportStage } from '@/types/importer';

import { ClientService } from './client';

const {
  mockImportData,
  mockImportPgData,
  mockImportAppSettings,
  mockQueue,
  mockDataImporterRepos,
  mockTransaction,
} = vi.hoisted(() => ({
  mockDataImporterRepos: vi.fn(),
  mockImportAppSettings: vi.fn(),
  mockImportData: vi.fn(),
  mockImportPgData: vi.fn(),
  mockQueue: vi.fn(),
  mockTransaction: { transaction: vi.fn() },
}));

vi.mock('@/database/repositories/dataImporter', () => ({
  DataImporterRepos: mockDataImporterRepos,
}));
vi.mock('@/database/client/db', () => ({
  clientDB: {},
}));
vi.mock('@/services/conversationWriteQueue', () => ({
  withClientConversationWriteQueue: mockQueue,
}));
vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: () => ({
      importAppSettings: mockImportAppSettings,
    }),
  },
}));

describe('client import conversation barrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportData.mockResolvedValue({
      results: { messages: { added: 1, errors: 0, skips: 0 } },
      success: true,
    });
    mockImportPgData.mockResolvedValue({
      results: { messages: { added: 1, errors: 0, skips: 0 } },
      success: true,
    });
    mockDataImporterRepos.mockImplementation(() => ({
      importData: mockImportData,
      importPgDataInTransaction: mockImportPgData,
    }));
    mockQueue.mockImplementation(
      async (_userId: string, operation: (transaction: unknown) => Promise<unknown>) =>
        operation(mockTransaction),
    );
  });

  it('runs JSON import inside the per-user conversation queue', async () => {
    const service = new ClientService('user-1');
    const onStageChange = vi.fn();
    const onSuccess = vi.fn();

    await service.importData({ messages: [], version: 1 } as any, {
      onStageChange,
      onSuccess,
    });

    expect(mockQueue).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(mockDataImporterRepos).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockImportData).toHaveBeenCalledWith({ messages: [], version: 1 });
    expect(onStageChange).toHaveBeenNthCalledWith(1, ImportStage.Importing);
    expect(onStageChange).toHaveBeenLastCalledWith(ImportStage.Success);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('runs PostgreSQL import inside the per-user conversation queue', async () => {
    const service = new ClientService('user-1');
    const importData = {
      data: {},
      mode: 'pglite',
      schemaHash: 'hash',
    };

    await service.importPgData(importData as any, { overwriteExisting: true });

    expect(mockQueue).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(mockDataImporterRepos).toHaveBeenCalledWith(mockTransaction, 'user-1');
    expect(mockImportPgData).toHaveBeenCalledWith(importData, 'replace');
  });
});
