import { afterEach, describe, expect, it, vi } from 'vitest';

import { DATA_BACKUP_TABLES } from '@/types/export';

import { ServerService } from './server';

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: vi.fn().mockResolvedValue({}),
}));

const createBackup = (mode: 'pglite' | 'postgres') => ({
  appVersion: 'test-version',
  data: Object.fromEntries(
    DATA_BACKUP_TABLES.map((table) => [table, table === 'users' ? [{ id: 'user-id' }] : []]),
  ),
  exportedAt: '2026-08-03T00:00:00.000Z',
  formatVersion: 2,
  mode,
  schemaHash: 'schema-hash',
  secretStrategy: 'deployment-keyed',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerService', () => {
  it('returns a version 2 PostgreSQL backup', async () => {
    const backup = createBackup('postgres');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(backup), { status: 200 })),
    );

    await expect(new ServerService().exportData()).resolves.toEqual(backup);
  });

  it('rejects a PGlite backup on the export path', async () => {
    const backup = createBackup('pglite');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(backup), { status: 200 })),
    );

    await expect(new ServerService().exportData()).rejects.toThrow(
      'Server returned a non-postgres backup',
    );
  });
});
