import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { SANDBOX_SHARED_INSTRUCTION_ID } from '@/tools/sandbox/const';
import { SANDBOX_SHARED_INSTRUCTION } from '@/tools/sandbox/systemRole';

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
  emptyPersistent: vi.fn(),
  files: { delete: vi.fn(), list: vi.fn(), set: vi.fn() },
  findProfile: vi.fn(),
  health: vi.fn(),
  isAdmin: vi.fn(),
  list: vi.fn(),
  listHubJobs: vi.fn(),
  purgeFinishedJobs: vi.fn(),
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
  purgeFinishedSandboxJobs: mocks.purgeFinishedJobs,
}));
vi.mock('@/server/services/sandbox/profiles/catalog', () => ({
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
vi.mock('@/server/services/sandbox/profiles/persistentEmpty', () => ({
  emptySandboxPersistentFolder: mocks.emptyPersistent,
}));
vi.mock('@/server/services/sandbox/profiles/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/sandbox/profiles/files')>();
  return {
    SandboxFileError: actual.SandboxFileError,
    deleteSandboxFile: mocks.files.delete,
    listSandboxFiles: mocks.files.list,
    setSandboxFile: mocks.files.set,
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
        api.setInstruction({
          ...scope,
          instruction: 'New text.',
          profileId: SANDBOX_SHARED_INSTRUCTION_ID,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        api.resetInstruction({ ...scope, profileId: SANDBOX_SHARED_INSTRUCTION_ID }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.upsertInstruction).not.toHaveBeenCalled();
      expect(mocks.deleteInstruction).not.toHaveBeenCalled();
    });

    it('checks the account scope before the admin list', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      await expect(
        caller('user:account-b').setInstruction({
          ...scope,
          instruction: 'New text.',
          profileId: SANDBOX_SHARED_INSTRUCTION_ID,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.isAdmin).not.toHaveBeenCalled();
    });

    it('saves and resets the General instruction', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const api = caller('user:account-a');

      await expect(
        api.setInstruction({
          ...scope,
          instruction: 'New text.',
          profileId: SANDBOX_SHARED_INSTRUCTION_ID,
        }),
      ).resolves.toEqual([{ enabled: true, id: 'general' }]);
      expect(mocks.upsertInstruction).toHaveBeenCalledWith(
        SANDBOX_SHARED_INSTRUCTION_ID,
        'New text.',
        'account-a',
      );

      await api.resetInstruction({ ...scope, profileId: SANDBOX_SHARED_INSTRUCTION_ID });
      expect(mocks.deleteInstruction).toHaveBeenCalledWith(SANDBOX_SHARED_INSTRUCTION_ID);
    });

    it('treats saving the built-in General instruction as a reset', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      await caller('user:account-a').setInstruction({
        ...scope,
        instruction: SANDBOX_SHARED_INSTRUCTION,
        profileId: SANDBOX_SHARED_INSTRUCTION_ID,
      });
      expect(mocks.upsertInstruction).not.toHaveBeenCalled();
      expect(mocks.deleteInstruction).toHaveBeenCalledWith(SANDBOX_SHARED_INSTRUCTION_ID);

      await caller('user:account-a').setInstruction({
        ...scope,
        instruction: 'OLD fixture text',
        profileId: SANDBOX_SHARED_INSTRUCTION_ID,
      });
      expect(mocks.upsertInstruction).toHaveBeenCalledWith(
        SANDBOX_SHARED_INSTRUCTION_ID,
        'OLD fixture text',
        'account-a',
      );
    });

    it('rejects a profile id, empty text, and text over 32 KiB', async () => {
      mocks.isAdmin.mockResolvedValue(true);
      const api = caller('user:account-a');

      await expect(
        api.setInstruction({ ...scope, instruction: 'x', profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(api.resetInstruction({ ...scope, profileId: 'data' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(
        api.setInstruction({
          ...scope,
          instruction: '  \n ',
          profileId: SANDBOX_SHARED_INSTRUCTION_ID,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // 32 KiB is fine; one more byte (a multi-byte character counts by bytes) is not.
      await api.setInstruction({
        ...scope,
        instruction: 'x'.repeat(32 * 1024),
        profileId: SANDBOX_SHARED_INSTRUCTION_ID,
      });
      await expect(
        api.setInstruction({
          ...scope,
          instruction: `${'x'.repeat(32 * 1024 - 1)}\u00E9`,
          profileId: SANDBOX_SHARED_INSTRUCTION_ID,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.upsertInstruction).toHaveBeenCalledTimes(1);
    });
  });

  describe('jobs', () => {
    const scope = { accountScope: 'user:account-a' };
    const jobs = [{ id: 'sjob_1', status: 'running' }];

    it('lists hub jobs, purges finished jobs, and cancels only the caller jobs', async () => {
      const listed = {
        finished: { items: [], page: 2, pageSize: 20, total: 0 },
        running: jobs,
      };
      mocks.listHubJobs.mockResolvedValue(listed);
      mocks.purgeFinishedJobs.mockResolvedValue({ deleted: 3 });
      mocks.cancelJob.mockResolvedValue({ id: 'sjob_1', status: 'cancelled' });
      const api = caller('user:account-a');

      await expect(api.listHubJobs({ ...scope, page: 2 })).resolves.toEqual(listed);
      expect(mocks.listHubJobs).toHaveBeenCalledWith({ db: {}, page: 2, userId: 'account-a' });

      await expect(api.purgeFinishedJobs(scope)).resolves.toEqual({ deleted: 3 });
      expect(mocks.purgeFinishedJobs).toHaveBeenCalledWith({ db: {}, userId: 'account-a' });

      await expect(api.cancelJob({ ...scope, jobId: 'sjob_1' })).resolves.toBeUndefined();
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
      await expect(caller('user:account-b').purgeFinishedJobs(scope)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks.cancelJob).not.toHaveBeenCalled();
      expect(mocks.purgeFinishedJobs).not.toHaveBeenCalled();
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
        sensitive: true,
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

  describe('persistent folder', () => {
    const scope = { accountScope: 'user:account-a' };

    it("empties the caller's own folder and returns a refusal with its code", async () => {
      mocks.emptyPersistent.mockResolvedValue({ ok: true });
      await caller('user:account-a').emptyPersistentFolder({ ...scope, profileId: 'data' });
      expect(mocks.emptyPersistent).toHaveBeenCalledWith({}, 'account-a', 'data');

      mocks.emptyPersistent.mockResolvedValue({
        code: 'PRECONDITION_FAILED',
        message: 'This sandbox has no persistent folder.',
        ok: false,
      });
      await expect(
        caller('user:account-a').emptyPersistentFolder({ ...scope, profileId: 'data' }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'This sandbox has no persistent folder.',
      });

      await expect(
        caller('user:account-b').emptyPersistentFolder({ ...scope, profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('secret files', () => {
    const scope = { accountScope: 'user:account-a' };
    const list = {
      available: true,
      profiles: {
        data: {
          mine: [],
          shared: [
            {
              mode: '600',
              path: '/root/.oci/config',
              sensitive: true,
              size: 10,
              updatedAt: 'now',
            },
          ],
        },
      },
    };

    beforeEach(() => {
      mocks.files.list.mockResolvedValue(list);
      mocks.files.set.mockResolvedValue(undefined);
      mocks.files.delete.mockResolvedValue(undefined);
    });

    it('lists files and lets any user write their own', async () => {
      const api = caller('user:account-a');
      await expect(api.listFiles(scope)).resolves.toEqual(list);
      expect(mocks.files.list).toHaveBeenCalledWith({}, 'account-a');

      const content = Buffer.from('[DEFAULT]').toString('base64');
      await api.setMyFile({
        ...scope,
        content,
        mode: '600',
        path: '/root/.oci/config',
        profileId: 'data',
      });
      expect(mocks.files.set).toHaveBeenCalledWith({
        content,
        db: {},
        mode: '600',
        owner: { userId: 'account-a' },
        path: '/root/.oci/config',
        profileId: 'data',
        sensitive: true,
        updatedBy: 'account-a',
      });

      // Without content: a mode change only.
      await api.setMyFile({ ...scope, mode: '400', path: '/root/.oci/config', profileId: 'data' });
      expect(mocks.files.set).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: undefined, mode: '400' }),
      );

      await api.deleteMyFile({ ...scope, path: '/root/.oci/config', profileId: 'data' });
      expect(mocks.files.delete).toHaveBeenCalledWith({
        db: {},
        owner: { userId: 'account-a' },
        path: '/root/.oci/config',
        profileId: 'data',
      });
    });

    it('lets only admins write shared files', async () => {
      const api = caller('user:account-a');
      const input = { ...scope, content: 'eA==', mode: '600', path: '/root/x', profileId: 'data' };
      await expect(api.setSharedFile(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        api.deleteSharedFile({ ...scope, path: '/root/x', profileId: 'data' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.files.set).not.toHaveBeenCalled();

      mocks.isAdmin.mockResolvedValue(true);
      await api.setSharedFile({ ...input, sensitive: false });
      expect(mocks.files.set).toHaveBeenCalledWith(
        expect.objectContaining({ owner: { shared: true }, sensitive: false }),
      );
      await api.deleteSharedFile({ ...scope, path: '/root/x', profileId: 'data' });
      expect(mocks.files.delete).toHaveBeenCalledWith(
        expect.objectContaining({ owner: { shared: true } }),
      );
    });

    it('rejects unknown profiles, oversized content and refused writes', async () => {
      const api = caller('user:account-a');
      await expect(
        api.setMyFile({
          ...scope,
          content: 'eA==',
          mode: '600',
          path: '/root/x',
          profileId: 'nope',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        api.setMyFile({
          ...scope,
          content: 'A'.repeat(90 * 1024),
          mode: '600',
          path: '/root/x',
          profileId: 'data',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.files.set).not.toHaveBeenCalled();

      const { SandboxFileError } = await import('@/server/services/sandbox/profiles/files');
      mocks.files.set.mockRejectedValue(
        new SandboxFileError('BAD_REQUEST', '/proc/x is inside a system folder.'),
      );
      await expect(
        api.setMyFile({
          ...scope,
          content: 'eA==',
          mode: '600',
          path: '/proc/x',
          profileId: 'data',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: '/proc/x is inside a system folder.',
      });
    });
  });
});
