// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  empty: vi.fn(),
  profiles: new Map<string, Record<string, unknown>>(),
  serverStatus: 'ok' as string,
}));

vi.mock('../hub', () => ({
  findSandboxProfile: async (_db: unknown, id: string) => mocks.profiles.get(id),
}));
vi.mock('../load', () => ({
  findSandboxServer: (id: string) => ({ id, status: mocks.serverStatus }),
}));
vi.mock('../../registry', () => ({
  getSandboxProvider: () => ({ emptyPersistentFolder: mocks.empty }),
}));

const { emptySandboxPersistentFolder } = await import('../persistentEmpty');
const { persistentVolumeName } = await import('../persistent');

const db = {} as never;

describe('emptySandboxPersistentFolder', () => {
  beforeEach(() => {
    mocks.empty.mockReset();
    mocks.empty.mockResolvedValue(undefined);
    mocks.serverStatus = 'ok';
    mocks.profiles = new Map([
      ['data', { id: 'data', persistentFolder: '/persist', serverId: 'remote' }],
      ['plain', { id: 'plain', serverId: 'remote' }],
    ]);
  });

  it("empties only the caller's own volume", async () => {
    expect(await emptySandboxPersistentFolder(db, 'user-1', 'data')).toEqual({ ok: true });
    expect(mocks.empty).toHaveBeenCalledWith(
      { claimName: persistentVolumeName('data', 'user-1'), mountPath: '/persist' },
      expect.any(AbortSignal),
    );
  });

  it('refuses unknown profiles, profiles without a folder, and broken servers', async () => {
    expect(await emptySandboxPersistentFolder(db, 'user-1', 'nope')).toMatchObject({
      code: 'NOT_FOUND',
      ok: false,
    });
    expect(await emptySandboxPersistentFolder(db, 'user-1', 'plain')).toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This sandbox has no persistent folder.',
    });
    mocks.serverStatus = 'misconfigured';
    expect(await emptySandboxPersistentFolder(db, 'user-1', 'data')).toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(mocks.empty).not.toHaveBeenCalled();
  });

  it('returns a failed empty with its message', async () => {
    mocks.empty.mockRejectedValue(new Error('Could not empty /persist: busy'));
    expect(await emptySandboxPersistentFolder(db, 'user-1', 'data')).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not empty /persist: busy',
      ok: false,
    });
  });
});
