import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  MockConversationWriteRejectedError,
  mockAdvanceConversationVersion,
  mockCreateLambdaContext,
  mockGetServerDB,
  mockImportPgDataInTransaction,
  mockParseAndPreflight,
  mockWithConversationWriteLockOrThrow,
} = vi.hoisted(() => ({
  MockConversationWriteRejectedError: class ConversationWriteRejectedError extends Error {},
  mockAdvanceConversationVersion: vi.fn(),
  mockCreateLambdaContext: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockImportPgDataInTransaction: vi.fn(),
  mockParseAndPreflight: vi.fn(),
  mockWithConversationWriteLockOrThrow: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/context', () => ({
  createLambdaContext: (...args: unknown[]) => mockCreateLambdaContext(...args),
}));
vi.mock('@/database/server', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));
vi.mock('@/database/repositories/dataImporter', () => ({
  DataImporterRepos: vi.fn().mockImplementation(() => ({
    importPgDataInTransaction: mockImportPgDataInTransaction,
  })),
}));
vi.mock('@/server/services/conversationWriteLock', () => ({
  ConversationWriteRejectedError: MockConversationWriteRejectedError,
  advanceConversationVersion: (...args: unknown[]) => mockAdvanceConversationVersion(...args),
  withConversationWriteLockOrThrow: (...args: unknown[]) =>
    mockWithConversationWriteLockOrThrow(...args),
}));
vi.mock('@/server/services/dataBackup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/dataBackup')>();
  return {
    ...actual,
    parseAndPreflightDatabaseBackup: (...args: unknown[]) => mockParseAndPreflight(...args),
  };
});

const backup = {
  appVersion: '1.0.15',
  data: { messages: [{ id: 'message-1', role: 'user' }] },
  exportedAt: '2026-01-02T03:04:05.000Z',
  formatVersion: 2,
  mode: 'postgres',
  schemaHash: 'schema-hash',
  secretStrategy: 'deployment-keyed',
} as const;

const createRequest = (body: unknown, search = '') =>
  new NextRequest(`http://localhost/webapi/data/import${search}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

describe('POST /webapi/data/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLambdaContext.mockResolvedValue({ userId: 'user-1' });
    mockGetServerDB.mockResolvedValue({ database: true });
    mockParseAndPreflight.mockResolvedValue({
      backup,
      format: 'v2',
      ignoredTables: [],
    });
    mockImportPgDataInTransaction.mockResolvedValue({
      results: { messages: { added: 1 } },
      success: true,
    });
    mockWithConversationWriteLockOrThrow.mockImplementation(
      async (
        _database: unknown,
        _userId: string,
        callback: (transaction: unknown) => Promise<unknown>,
      ) => callback({ transaction: true }),
    );
  });

  it('requires authentication before reading or mutating data', async () => {
    mockCreateLambdaContext.mockResolvedValue({});

    const response = await POST(createRequest(backup));

    expect(response.status).toBe(401);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('preflights and atomically imports with the requested strategy and version', async () => {
    const response = await POST(
      createRequest(backup, '?strategy=replace&expectedConversationVersion=7'),
    );

    expect(response.status).toBe(200);
    expect(mockParseAndPreflight).toHaveBeenCalledWith(backup, { database: true });
    expect(mockWithConversationWriteLockOrThrow).toHaveBeenCalledWith(
      { database: true },
      'user-1',
      expect.any(Function),
      7,
    );
    expect(mockImportPgDataInTransaction).toHaveBeenCalledWith(backup, 'replace');
    expect(mockAdvanceConversationVersion).toHaveBeenCalledWith(
      { transaction: true },
      'user-1',
    );
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('rejects invalid strategies without starting the import', async () => {
    const response = await POST(createRequest(backup, '?strategy=overwrite'));

    expect(response.status).toBe(400);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('surfaces a version conflict without importing', async () => {
    mockWithConversationWriteLockOrThrow.mockRejectedValue(
      new MockConversationWriteRejectedError(),
    );

    const response = await POST(createRequest(backup));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONVERSATION_VERSION_CONFLICT',
    });
    expect(mockAdvanceConversationVersion).not.toHaveBeenCalled();
  });

  it('returns rollback failure and never advances after repository failure', async () => {
    mockImportPgDataInTransaction.mockRejectedValue(new Error('insert failed'));

    const response = await POST(createRequest(backup));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'IMPORT_FAILED_ROLLED_BACK',
    });
    expect(mockAdvanceConversationVersion).not.toHaveBeenCalled();
  });
});
