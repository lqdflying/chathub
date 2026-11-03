import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { sandboxHubRouter } from '../sandboxHub';

const mocks = vi.hoisted(() => ({
  admin: {
    create: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    prepare: vi.fn(),
    settings: vi.fn(),
    update: vi.fn(),
  },
  cancelJob: vi.fn(),
  deleteInstruction: vi.fn(),
  env: { delete: vi.fn(), list: vi.fn(), set: vi.fn() },
  findProfile: vi.fn(),
  health: vi.fn(),
  isAdmin: vi.fn(),
  list: vi.fn(),
  listHubJobs: vi.fn(),
  listJobs: vi.fn(),
  purgeSucceededJobs: vi.fn(),
  setEnabled: vi.fn(),
  startingInstruction: vi.fn(),
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
vi.mock('@/server/services/sandbox/profiles/hubAdmin', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/sandbox/profiles/hubAdmin')>();
  return {
    SandboxHubProfileError: actual.SandboxHubProfileError,
    createSandboxHubProfile: mocks.admin.create,
    deleteSandboxHubProfile: mocks.admin.delete,
    getSandboxHubSettings: mocks.admin.settings,
    moveSandboxHubProfile: mocks.admin.move,
    prepareSandboxHubProfileImage: mocks.admin.prepare,
    updateSandboxHubProfile: mocks.admin.update,
  };
});
vi.mock('@/server/services/sandbox/jobs/service', () => ({
  cancelSandboxJob: mocks.cancelJob,
  listSandboxHubJobs: mocks.listHubJobs,
  listSandboxJobs: mocks.listJobs,
  purgeSucceededSandboxJobs: mocks.purgeSucceededJobs,
}));
vi.mock('@/server/services/sandbox/profiles/catalog', () => ({
  getSandboxStartingInstruction: mocks.startingInstruction,
  getUserSandboxProfiles: mocks.list,
}));
vi.mock('@/server/services/sandbox/profiles/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/sandbox/profiles/env')>();
  return {
    SandboxEnvError: actual.SandboxEnvError,
    deleteSandboxEnv: mocks.env.delete,
    listSandboxEnvs: mocks.env.list,
    setSandboxEnv: mocks.env.set,
  };
});
vi.mock('@/server/services/sandbox/profiles/hub', () => ({
  findSandboxProfile: async (_db: unknown, id: string) => mocks.findProfile(id),
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
    mocks.startingInstruction.mockResolvedValue('Starting text.');
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
      mocks.startingInstruction.mockResolvedValue('Starting text.');
      await caller('user:account-a').setInstruction({
        ...scope,
        instruction: 'Starting text.',
        profileId: 'data',
      });
      expect(mocks.upsertInstruction).not.toHaveBeenCalled();
      expect(mocks.deleteInstruction).toHaveBeenCalledWith('data');

      await caller('user:account-a').setInstruction({
        ...scope,
        instruction: 'OLD fixture text',
        profileId: 'data',
      });
      expect(mocks.upsertInstruction).toHaveBeenCalledWith('data', 'OLD fixture text', 'account-a');
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

  describe('profile administration', () => {
    const scope = { accountScope: 'user:account-a' };
    const settings = {
      defaultEnabled: false,
      description: 'Data',
      instructionBase: 'general' as const,
      name: 'Data',
      serverId: 'default',
    };

    beforeEach(() => {
      mocks.admin.settings.mockResolvedValue({ profiles: [] });
    });

    it('is for admins only', async () => {
      const api = caller('user:account-a');
      await expect(api.profileSettings(scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(api.createProfile({ ...scope, id: 'data', settings })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(api.deleteProfile({ ...scope, id: 'data' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(api.prepareImage({ ...scope, id: 'data' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks.admin.create).not.toHaveBeenCalled();
      expect(mocks.admin.delete).not.toHaveBeenCalled();
      expect(mocks.admin.prepare).not.toHaveBeenCalled();
    });

    it('runs each change and returns the refreshed settings', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const api = caller('user:account-a');

      await expect(api.createProfile({ ...scope, id: 'data', settings })).resolves.toEqual({
        profiles: [],
      });
      expect(mocks.admin.create).toHaveBeenCalledWith({}, 'account-a', 'data', settings);
      await api.updateProfile({ ...scope, id: 'data', settings: { ...settings, cpu: '2' } });
      expect(mocks.admin.update).toHaveBeenCalledWith({}, 'account-a', 'data', {
        ...settings,
        cpu: '2',
      });
      await api.moveProfile({ ...scope, direction: 'up', id: 'data' });
      expect(mocks.admin.move).toHaveBeenCalledWith({}, 'data', 'up');
      await api.prepareImage({ ...scope, id: 'data' });
      expect(mocks.admin.prepare).toHaveBeenCalledWith({}, 'data');
      await api.deleteProfile({ ...scope, id: 'data' });
      expect(mocks.admin.delete).toHaveBeenCalledWith({}, 'data');
      await expect(api.profileSettings(scope)).resolves.toEqual({ profiles: [] });
    });

    it('returns a rejected change with its code and message', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const { SandboxHubProfileError } =
        await import('@/server/services/sandbox/profiles/hubAdmin');
      mocks.admin.delete.mockRejectedValue(
        new SandboxHubProfileError('BAD_REQUEST', 'The last profile cannot be deleted.'),
      );
      await expect(
        caller('user:account-a').deleteProfile({ ...scope, id: 'data' }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'The last profile cannot be deleted.',
      });

      await expect(
        caller('user:account-a').createProfile({ ...scope, id: 'Bad_Id', settings }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('environment variables', () => {
    const scope = { accountScope: 'user:account-a' };
    const list = {
      available: true,
      profiles: { data: { mine: [], shared: [{ name: 'API_TOKEN', updatedAt: 'now' }] } },
    };

    beforeEach(() => {
      mocks.env.list.mockResolvedValue(list);
      mocks.env.set.mockResolvedValue(undefined);
      mocks.env.delete.mockResolvedValue(undefined);
    });

    it('lists names and hints, and lets any user write their own', async () => {
      const api = caller('user:account-a');
      await expect(api.listEnvs(scope)).resolves.toEqual(list);
      expect(mocks.env.list).toHaveBeenCalledWith({}, 'account-a');

      const result = await api.setMyEnv({
        ...scope,
        name: 'API_TOKEN',
        profileId: 'data',
        value: 'my-secret-value',
      });
      expect(mocks.env.set).toHaveBeenCalledWith({
        db: {},
        name: 'API_TOKEN',
        owner: { userId: 'account-a' },
        profileId: 'data',
        updatedBy: 'account-a',
        value: 'my-secret-value',
      });
      expect(JSON.stringify(result)).not.toContain('my-secret-value');

      await api.deleteMyEnv({ ...scope, name: 'API_TOKEN', profileId: 'data' });
      expect(mocks.env.delete).toHaveBeenCalledWith({
        db: {},
        name: 'API_TOKEN',
        owner: { userId: 'account-a' },
        profileId: 'data',
      });
    });

    it('lets only admins write shared variables', async () => {
      const api = caller('user:account-a');
      await expect(
        api.setSharedEnv({ ...scope, name: 'API_TOKEN', profileId: 'data', value: 'x' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        api.deleteSharedEnv({ ...scope, name: 'API_TOKEN', profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.env.set).not.toHaveBeenCalled();
      expect(mocks.env.delete).not.toHaveBeenCalled();

      mocks.isAdmin.mockResolvedValue(true);
      await api.setSharedEnv({ ...scope, name: 'API_TOKEN', profileId: 'data', value: 'x' });
      expect(mocks.env.set).toHaveBeenCalledWith(
        expect.objectContaining({ owner: { shared: true }, profileId: 'data' }),
      );
      await api.deleteSharedEnv({ ...scope, name: 'API_TOKEN', profileId: 'data' });
      expect(mocks.env.delete).toHaveBeenCalledWith(
        expect.objectContaining({ owner: { shared: true } }),
      );
    });

    it('rejects unknown profiles and returns a refused write with its code', async () => {
      const api = caller('user:account-a');
      await expect(
        api.setMyEnv({ ...scope, name: 'API_TOKEN', profileId: 'nope', value: 'x' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mocks.env.set).not.toHaveBeenCalled();

      const { SandboxEnvError } = await import('@/server/services/sandbox/profiles/env');
      mocks.env.set.mockRejectedValue(new SandboxEnvError('BAD_REQUEST', 'PATH is reserved.'));
      await expect(
        api.setMyEnv({ ...scope, name: 'PATH', profileId: 'data', value: 'x' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'PATH is reserved.' });
    });
  });
});
