import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_BACKUP_TABLES } from '@/types/export';

import { GET } from './route';

const { mockCreateLambdaContext, mockExport, mockGetLatestMigrationHash, mockGetServerDB } =
  vi.hoisted(() => ({
    mockCreateLambdaContext: vi.fn(),
    mockExport: vi.fn(),
    mockGetLatestMigrationHash: vi.fn(),
    mockGetServerDB: vi.fn(),
  }));

vi.mock('@/libs/trpc/lambda/context', () => ({
  createLambdaContext: (...args: unknown[]) => mockCreateLambdaContext(...args),
}));
vi.mock('@/database/server', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));
vi.mock('@/database/repositories/dataExporter', () => ({
  DataExporterRepos: vi.fn().mockImplementation(() => ({ export: mockExport })),
}));
vi.mock('@/database/models/drizzleMigration', () => ({
  DrizzleMigrationModel: vi
    .fn()
    .mockImplementation(() => ({ getLatestMigrationHash: mockGetLatestMigrationHash })),
}));

describe('GET /webapi/data/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLambdaContext.mockResolvedValue({ userId: 'user-1' });
    mockGetServerDB.mockResolvedValue({ database: true });
    mockExport.mockResolvedValue({
      ...Object.fromEntries(DATA_BACKUP_TABLES.map((table) => [table, []])),
      messages: [{ id: 'message-1' }],
      users: [{}],
    });
    mockGetLatestMigrationHash.mockResolvedValue('schema-hash');
  });

  it('requires authentication', async () => {
    mockCreateLambdaContext.mockResolvedValue({});

    const response = await GET(new NextRequest('http://localhost/webapi/data/export'));

    expect(response.status).toBe(401);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('returns a complete no-cache v2 attachment with the actual schema hash', async () => {
    const response = await GET(new NextRequest('http://localhost/webapi/data/export'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain('data-v2.json');
    expect(body).toMatchObject({
      data: { messages: [{ id: 'message-1' }] },
      formatVersion: 2,
      mode: 'postgres',
      schemaHash: 'schema-hash',
      secretStrategy: 'deployment-keyed',
    });
  });

  it('does not return a partial backup when export fails', async () => {
    mockExport.mockRejectedValue(new Error('query failed'));

    const response = await GET(new NextRequest('http://localhost/webapi/data/export'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'EXPORT_FAILED' });
  });
});
