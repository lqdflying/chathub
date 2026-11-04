// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  choicesDeleted: [] as string[],
  envImage: 'chathub-sandbox:2' as string | undefined,
  instructionsDeleted: [] as string[],
  prepared: [] as Array<{ id: string; image: string }>,
  rows: [] as Array<Record<string, any>>,
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('../../registry', () => ({ getSandboxProvider: () => ({}) }));
vi.mock('@/database/models/sandboxProfileInstruction', () => ({
  SandboxProfileInstructionModel: class {
    list = async () => new Map();
  },
}));
vi.mock('@/database/models/sandboxHubProfile', () => ({
  SandboxHubProfileModel: class {
    count = async () => state.rows.length;
    create = async (fields: Record<string, unknown>, updatedBy: string) => {
      state.rows.push({ ...fields, updatedBy });
    };
    deleteWithRelated = async (id: string) => {
      state.rows = state.rows.filter((row) => row.id !== id);
      state.choicesDeleted.push(id);
      state.instructionsDeleted.push(id);
    };
    find = async (id: string) => state.rows.find((row) => row.id === id);
    list = async () => state.rows;
    move = async () => true;
    update = async (id: string, settings: Record<string, unknown>, updatedBy: string) => {
      const row = state.rows.find((item) => item.id === id);
      if (!row) return undefined;
      Object.assign(row, settings, { updatedBy });
      return row;
    };
  },
}));
vi.mock('../load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  findSandboxServer: (id: string) =>
    ({
      default: { id: 'default', name: 'Default', status: 'ok' },
      locked: { id: 'locked', name: 'Locked', status: 'misconfigured' },
    })[id],
  getSandboxFileCatalog: () => ({
    servers: [
      { apiKey: 'k', id: 'default', name: 'Default', status: 'ok', url: 'http://a' },
      { id: 'locked', name: 'Locked', status: 'misconfigured', url: 'https://b' },
    ],
  }),
  readSandboxProfilesEnv: () => ({
    OPENSANDBOX_CPU: '1',
    OPENSANDBOX_EGRESS_ALLOW: 'pypi.org',
    OPENSANDBOX_IMAGE: state.envImage,
    OPENSANDBOX_MEMORY: '2Gi',
    OPENSANDBOX_READY_TIMEOUT: 60_000,
    OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
    OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
  }),
}));
vi.mock('../hub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hub')>()),
  getSandboxProfileCatalog: async () => ({}),
}));
vi.mock('../prepare', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../prepare')>()),
  startSandboxImagePreparation: async (_db: unknown, row: { id: string }, image: string) => {
    state.prepared.push({ id: row.id, image });
  },
}));

const {
  createSandboxHubProfile,
  deleteSandboxHubProfile,
  getSandboxHubSettings,
  moveSandboxHubProfile,
  prepareSandboxHubProfileImage,
  updateSandboxHubProfile,
} = await import('../hubAdmin');

const db = {} as never;

const input = (extra: Record<string, unknown> = {}) => ({
  defaultEnabled: false,
  description: 'Python with the data stack',
  instructionBase: 'general' as const,
  name: 'Data',
  serverId: 'default',
  ...extra,
});

const storedRow = (id: string, extra: Record<string, unknown> = {}) => ({
  avatar: null,
  cpu: null,
  defaultEnabled: id === 'general',
  description: `${id} profile`,
  egress: null,
  id,
  image: null,
  imageCheckedAt: null,
  imageCheckedRef: null,
  imageStatus: 'unknown',
  imageStatusMessage: null,
  instructionBase: 'general',
  instructionText: null,
  jobMaxRuntimeMs: null,
  memory: null,
  name: id,
  readyTimeoutMs: null,
  serverId: 'default',
  sessionIdleTimeoutMs: null,
  sessionMaxLifetimeMs: null,
  updatedAt: new Date('2026-11-02T08:00:00Z'),
  ...extra,
});

describe('Sandbox Hub profile administration', () => {
  beforeEach(() => {
    state.choicesDeleted = [];
    state.envImage = 'chathub-sandbox:2';
    state.instructionsDeleted = [];
    state.prepared = [];
    state.rows = [storedRow('general')];
  });

  it('creates a profile with blank settings inheriting, and the editor recorded', async () => {
    await createSandboxHubProfile(
      db,
      'admin-1',
      'data',
      input({
        cpu: ' 2 ',
        egress: ['pypi.org'],
        image: '',
        memory: null,
        sessionIdleTimeoutMs: 3_600_000,
      }),
    );
    expect(state.rows[1]).toEqual({
      avatar: null,
      cpu: '2',
      defaultEnabled: false,
      description: 'Python with the data stack',
      egress: ['pypi.org'],
      id: 'data',
      image: null,
      instructionBase: 'general',
      instructionText: null,
      jobMaxRuntimeMs: null,
      memory: null,
      name: 'Data',
      readyTimeoutMs: null,
      serverId: 'default',
      sessionIdleTimeoutMs: 3_600_000,
      sessionMaxLifetimeMs: null,
      updatedBy: 'admin-1',
    });
  });

  it('rejects what the profiles file would reject, unknown servers, and a missing image', async () => {
    await expect(createSandboxHubProfile(db, 'a', 'Bad_Id', input())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('profile id must be'),
    });
    await expect(
      createSandboxHubProfile(db, 'a', 'data', input({ readyTimeoutMs: 0 })),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('readyTimeoutMs'),
    });
    await expect(
      createSandboxHubProfile(db, 'a', 'data', input({ serverId: 'gone' })),
    ).rejects.toMatchObject({ message: 'Server "gone" is not in SANDBOX_PROFILES_FILE.' });

    state.envImage = undefined;
    await expect(createSandboxHubProfile(db, 'a', 'data', input())).rejects.toMatchObject({
      message: 'Set an image: OPENSANDBOX_IMAGE is unset.',
    });
    await createSandboxHubProfile(db, 'a', 'data', input({ image: 'data:1' }));
    expect(state.rows).toHaveLength(2);
  });

  it('refuses a duplicate id and more than 16 profiles', async () => {
    await expect(createSandboxHubProfile(db, 'a', 'general', input())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    state.rows = Array.from({ length: 16 }, (_, index) => storedRow(`p${index}`));
    await expect(createSandboxHubProfile(db, 'a', 'data', input())).rejects.toMatchObject({
      message: 'Sandbox Hub holds at most 16 profiles.',
    });
  });

  it('stores a bare memory number as GiB and keeps a value that already has a unit', async () => {
    await createSandboxHubProfile(db, 'admin-1', 'data', input({ memory: ' 2 ' }));
    expect(state.rows[1].memory).toBe('2Gi');

    await updateSandboxHubProfile(db, 'admin-1', 'data', input({ memory: '0.5' }));
    expect(state.rows[1].memory).toBe('512Mi');

    await updateSandboxHubProfile(db, 'admin-1', 'data', input({ memory: '512Mi' }));
    expect(state.rows[1].memory).toBe('512Mi');

    await updateSandboxHubProfile(db, 'admin-1', 'data', input({ memory: null }));
    expect(state.rows[1].memory).toBeNull();
  });

  it('updates settings and reports a missing profile', async () => {
    await updateSandboxHubProfile(
      db,
      'admin-2',
      'general',
      input({ image: 'next:2', name: 'Sandbox' }),
    );
    expect(state.rows[0]).toMatchObject({ image: 'next:2', name: 'Sandbox', updatedBy: 'admin-2' });
    await expect(updateSandboxHubProfile(db, 'a', 'missing', input())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps general and the last profile, and cleans up after a delete', async () => {
    await expect(deleteSandboxHubProfile(db, 'general')).rejects.toMatchObject({
      message: expect.stringContaining('general profile cannot be deleted'),
    });
    state.rows = [storedRow('data')];
    await expect(deleteSandboxHubProfile(db, 'data')).rejects.toMatchObject({
      message: 'The last profile cannot be deleted.',
    });

    state.rows = [storedRow('general'), storedRow('data')];
    await deleteSandboxHubProfile(db, 'data');
    expect(state.rows.map((row) => row.id)).toEqual(['general']);
    expect(state.instructionsDeleted).toEqual(['data']);
    expect(state.choicesDeleted).toEqual(['data']);
    await expect(deleteSandboxHubProfile(db, 'data')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moves and prepares existing profiles only', async () => {
    await moveSandboxHubProfile(db, 'general', 'down');
    await expect(moveSandboxHubProfile(db, 'missing', 'up')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await prepareSandboxHubProfileImage(db, 'general');
    expect(state.prepared).toEqual([{ id: 'general', image: 'chathub-sandbox:2' }]);
    await expect(prepareSandboxHubProfileImage(db, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shows settings, inherited defaults, servers, issues and image status', async () => {
    state.rows = [
      storedRow('general', {
        imageCheckedAt: new Date(),
        imageCheckedRef: 'chathub-sandbox:2',
        imageStatus: 'ready',
        imageStatusMessage: 'Ready after 3 s.',
      }),
      storedRow('orphan', { serverId: 'gone' }),
      storedRow('locked', { imageCheckedRef: 'old:1', imageStatus: 'ready', serverId: 'locked' }),
    ];
    const settings = await getSandboxHubSettings(db);

    expect(settings.defaults).toEqual({
      cpu: '1',
      egress: { mode: 'allowlist', targets: ['pypi.org'] },
      image: 'chathub-sandbox:2',
      jobMaxRuntimeMs: 7_200_000,
      memory: '2Gi',
      readyTimeoutMs: 60_000,
      sessionIdleTimeoutMs: 1_800_000,
      sessionMaxLifetimeMs: 0,
    });
    expect(settings.maxProfiles).toBe(16);
    expect(settings.servers).toEqual([
      { id: 'default', name: 'Default', status: 'ok' },
      { id: 'locked', name: 'Locked', status: 'misconfigured' },
    ]);
    const [general, orphan, locked] = settings.profiles;
    expect(general).toMatchObject({
      deletable: false,
      imageStatus: 'ready',
      imageStatusMessage: 'Ready after 3 s.',
      updatedAt: '2026-11-02T08:00:00.000Z',
    });
    expect(general).not.toHaveProperty('issue');
    expect(orphan).toMatchObject({
      deletable: true,
      issue: 'Server "gone" is not in SANDBOX_PROFILES_FILE.',
    });
    // A status for another image is not shown.
    expect(locked).toMatchObject({
      imageStatus: 'unknown',
      issue: 'Server "locked" is missing its API key.',
    });
  });
});
