import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { sandboxHubRouter } from '../sandboxHub';

const mocks = vi.hoisted(() => ({
  findProfile: vi.fn(),
  health: vi.fn(),
  list: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/sandboxProfile', () => ({
  SandboxProfileModel: class {
    setEnabled = mocks.setEnabled;
  },
}));
vi.mock('@/server/services/sandbox/profiles/catalog', () => ({
  getUserSandboxProfiles: mocks.list,
}));
vi.mock('@/server/services/sandbox/profiles/load', () => ({
  findSandboxProfile: mocks.findProfile,
}));
vi.mock('@/server/services/sandbox/profiles/status', () => ({
  getSandboxServerHealth: mocks.health,
}));

const caller = (accountScope?: string) =>
  sandboxHubRouter.createCaller({
    accountScope,
    clerkAuth: { userId: 'account-a' },
    userId: 'account-a',
  } as never);

describe('sandboxHubRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    mocks.list.mockResolvedValue([{ enabled: true, id: 'general' }]);
    mocks.health.mockResolvedValue({ default: 'ok' });
    mocks.findProfile.mockImplementation((id: string) => (id === 'data' ? { id } : undefined));
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'user:account-b'],
  ])('rejects a %s account scope', async (_case, accountScope) => {
    await expect(
      caller(accountScope).listProfiles({ accountScope: 'user:account-a' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists profiles and server health for the caller', async () => {
    const api = caller('user:account-a');
    await expect(api.listProfiles({ accountScope: 'user:account-a' })).resolves.toEqual([
      { enabled: true, id: 'general' },
    ]);
    expect(mocks.list).toHaveBeenCalledWith({}, 'account-a');
    await expect(api.serverStatus({ accountScope: 'user:account-a' })).resolves.toEqual({
      default: 'ok',
    });
  });

  it('stores a toggle only for a configured profile', async () => {
    const api = caller('user:account-a');
    await api.setProfileEnabled({
      accountScope: 'user:account-a',
      enabled: true,
      profileId: 'data',
    });
    expect(mocks.setEnabled).toHaveBeenCalledWith('data', true);

    await expect(
      api.setProfileEnabled({ accountScope: 'user:account-a', enabled: true, profileId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      api.setProfileEnabled({ accountScope: 'user:account-a', enabled: true, profileId: 'Bad_Id' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.setEnabled).toHaveBeenCalledTimes(1);
  });
});
