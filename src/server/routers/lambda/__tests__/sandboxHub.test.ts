import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { sandboxHubRouter } from '../sandboxHub';

const mocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deleteInstruction: vi.fn(),
  findProfile: vi.fn(),
  health: vi.fn(),
  isAdmin: vi.fn(),
  list: vi.fn(),
  listJobs: vi.fn(),
  setEnabled: vi.fn(),
  upsertInstruction: vi.fn(),
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
vi.mock('@/database/models/sandboxProfileInstruction', () => ({
  SandboxProfileInstructionModel: class {
    delete = mocks.deleteInstruction;
    upsert = mocks.upsertInstruction;
  },
}));
vi.mock('@/server/services/sandbox/profiles/admins', () => ({
  hasSandboxHubAdmins: () => true,
  isSandboxHubAdmin: mocks.isAdmin,
}));
vi.mock('@/server/services/sandbox/jobs/service', () => ({
  cancelSandboxJob: mocks.cancelJob,
  listSandboxJobs: mocks.listJobs,
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
    mocks.findProfile.mockImplementation((id: string) =>
      id === 'data' ? { id, instruction: 'Starting text.' } : undefined,
    );
    mocks.isAdmin.mockResolvedValue(false);
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

  describe('instructions', () => {
    const scope = { accountScope: 'user:account-a' };

    it('reports whether the caller may edit instructions', async () => {
      const api = caller('user:account-a');
      await expect(api.access(scope)).resolves.toEqual({
        adminsConfigured: true,
        canEditInstructions: false,
      });
      mocks.isAdmin.mockResolvedValue(true);
      await expect(api.access(scope)).resolves.toMatchObject({ canEditInstructions: true });
      expect(mocks.isAdmin).toHaveBeenCalledWith({}, 'account-a');
    });

    it('refuses edits and resets from non-admins', async () => {
      const api = caller('user:account-a');
      await expect(
        api.setInstruction({ ...scope, instruction: 'New text.', profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.resetInstruction({ ...scope, profileId: 'data' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks.upsertInstruction).not.toHaveBeenCalled();
      expect(mocks.deleteInstruction).not.toHaveBeenCalled();
    });

    it('checks the account scope before the admin list', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      await expect(
        caller('user:account-b').setInstruction({
          ...scope,
          instruction: 'New text.',
          profileId: 'data',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.isAdmin).not.toHaveBeenCalled();
    });

    it('saves and resets an admin edit for a configured profile', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const api = caller('user:account-a');

      await expect(
        api.setInstruction({ ...scope, instruction: 'New text.', profileId: 'data' }),
      ).resolves.toEqual([{ enabled: true, id: 'general' }]);
      expect(mocks.upsertInstruction).toHaveBeenCalledWith('data', 'New text.', 'account-a');

      await api.resetInstruction({ ...scope, profileId: 'data' });
      expect(mocks.deleteInstruction).toHaveBeenCalledWith('data');
    });

    it('treats saving the starting text as a reset', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      await caller('user:account-a').setInstruction({
        ...scope,
        instruction: 'Starting text.',
        profileId: 'data',
      });
      expect(mocks.upsertInstruction).not.toHaveBeenCalled();
      expect(mocks.deleteInstruction).toHaveBeenCalledWith('data');
    });

    it('rejects unknown profiles, empty text and text over 32 KiB', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const api = caller('user:account-a');

      await expect(
        api.setInstruction({ ...scope, instruction: 'x', profileId: 'nope' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.resetInstruction({ ...scope, profileId: 'nope' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        api.setInstruction({ ...scope, instruction: '  \n ', profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // 32 KiB is fine; one more byte (a multi-byte character counts by bytes) is not.
      await api.setInstruction({ ...scope, instruction: 'x'.repeat(32 * 1024), profileId: 'data' });
      await expect(
        api.setInstruction({
          ...scope,
          instruction: `${'x'.repeat(32 * 1024 - 1)}\u00E9`,
          profileId: 'data',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.upsertInstruction).toHaveBeenCalledTimes(1);
    });
  });

  describe('jobs', () => {
    const scope = { accountScope: 'user:account-a' };
    const jobs = [{ id: 'sjob_1', status: 'running' }];

    it('lists and cancels only the caller jobs', async () => {
      mocks.listJobs.mockResolvedValue(jobs);
      mocks.cancelJob.mockResolvedValue({ id: 'sjob_1', status: 'cancelled' });
      const api = caller('user:account-a');

      await expect(api.listJobs(scope)).resolves.toEqual(jobs);
      expect(mocks.listJobs).toHaveBeenCalledWith({ db: {}, userId: 'account-a' });

      await expect(api.cancelJob({ ...scope, jobId: 'sjob_1' })).resolves.toEqual(jobs);
      expect(mocks.cancelJob).toHaveBeenCalledWith({
        db: {},
        jobId: 'sjob_1',
        reason: 'Cancelled from Sandbox Hub.',
        userId: 'account-a',
      });

      mocks.cancelJob.mockResolvedValue(undefined);
      await expect(api.cancelJob({ ...scope, jobId: 'sjob_x' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('checks the account scope first', async () => {
      await expect(
        caller('user:account-b').cancelJob({ ...scope, jobId: 'sjob_1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(undefined).listJobs(scope)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks.cancelJob).not.toHaveBeenCalled();
      expect(mocks.listJobs).not.toHaveBeenCalled();
    });
  });
});
