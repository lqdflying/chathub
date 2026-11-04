// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choices: new Map<string, boolean>(),
  instructionError: undefined as unknown,
  instructions: new Map<string, { instruction: string; updatedAt: Date }>(),
  profiles: undefined as Array<Record<string, unknown>> | undefined,
  readError: undefined as unknown,
}));

vi.mock('@/database/models/sandboxProfileInstruction', () => ({
  SandboxProfileInstructionModel: class {
    list = async () => {
      if (mocks.instructionError) throw mocks.instructionError;
      return mocks.instructions;
    };
  },
}));

vi.mock('@/database/models/sandboxProfile', () => ({
  SandboxProfileModel: class {
    find = async (id: string) => {
      if (mocks.readError) throw mocks.readError;
      return mocks.choices.get(id);
    };
    list = async () => {
      if (mocks.readError) throw mocks.readError;
      return mocks.choices;
    };
  },
}));

const profile = (id: string, extra: Record<string, unknown> = {}) => ({
  cpu: '1',
  defaultEnabled: id === 'general',
  description: `${id} profile`,
  egress: { mode: 'open' },
  id,
  identifier: id === 'general' ? 'lobe-sandbox' : `lobe-sandbox--${id}`,
  image: 'img:1',
  instructionBase: 'general' as const,
  memory: '2Gi',
  name: id,
  readyTimeoutMs: 60_000,
  serverId: 'default',
  sessionIdleTimeoutMs: 1_800_000,
  sessionMaxLifetimeMs: 0,
  ...extra,
});

const catalogServers = [
  { apiKey: 'k', id: 'default', name: 'Default', status: 'ok', url: 'http://opensandbox:8090' },
  { id: 'locked', name: 'Locked', status: 'misconfigured', url: 'https://locked.example' },
];

vi.mock('../load', () => ({
  findSandboxServer: (id: string) => catalogServers.find((server) => server.id === id),
  isSandboxProfileUsable: (item: { serverId: string }) =>
    catalogServers.find((server) => server.id === item.serverId)?.status === 'ok',
}));
vi.mock('../hub', () => ({
  getSandboxProfileCatalog: async () => ({
    errors: [],
    profiles: mocks.profiles ?? [
      profile('general'),
      profile('data'),
      profile('vault', { defaultEnabled: true, serverId: 'locked' }),
      profile('orphan', { defaultEnabled: true, serverId: 'gone' }),
    ],
    seeds: [],
    servers: catalogServers,
    source: 'hub',
    warnings: [],
  }),
}));

const { composeSandboxInstruction } = await import('../compose');
const { DEFAULT_SANDBOX_INSTRUCTION, SANDBOX_SHARED_INSTRUCTION } =
  await import('@/tools/sandbox/systemRole');
const { createSandboxProfileManifest } = await import('@/tools/sandbox');

const {
  getUserEnabledSandboxProfiles,
  getUserSandboxManifests,
  getUserSandboxProfiles,
  resolveSandboxProfileForUser,
} = await import('../catalog');

const db = {} as never;

describe('Sandbox Hub catalog', () => {
  beforeEach(() => {
    mocks.choices = new Map();
    mocks.instructionError = undefined;
    mocks.instructions = new Map();
    mocks.profiles = undefined;
    mocks.readError = undefined;
  });

  it('builds every general-base profile on the saved General instruction', async () => {
    const unchanged = await getUserSandboxProfiles(db, 'user-1');
    expect(unchanged[0].instruction).toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(unchanged[0].instruction).not.toContain('Profile instructions:');
    expect(unchanged[0].instructionCustomized).toBe(false);
    expect(
      unchanged[1].instruction.startsWith('This tool is the "data" sandbox: data profile\n'),
    ).toBe(true);
    expect(unchanged[1].instruction).toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(unchanged[1].instruction).not.toContain('Profile instructions:');
    expect(SANDBOX_SHARED_INSTRUCTION).toContain('plot_N.png');
    expect(SANDBOX_SHARED_INSTRUCTION).not.toContain('.oci');

    mocks.profiles = [
      profile('general', { instructionText: 'Node is installed.' }),
      profile('data'),
    ];
    const withSandboxExtra = await getUserSandboxProfiles(db, 'user-1');
    const sandboxExtra = withSandboxExtra.find((item) => item.id === 'general')?.instruction ?? '';
    expect(sandboxExtra.match(/Node is installed\./g)).toHaveLength(1);
    expect(withSandboxExtra.find((item) => item.id === 'data')?.instruction).not.toContain(
      'Node is installed.',
    );
    mocks.profiles = undefined;

    const updatedAt = new Date('2026-11-01T08:00:00.000Z');
    mocks.instructions = new Map([['_shared', { instruction: 'Shared rule.', updatedAt }]]);
    const edited = await getUserSandboxProfiles(db, 'user-1');
    const sandbox = edited[0];
    const data = edited[1];
    expect(sandbox.instruction).toContain('Shared rule.');
    expect(sandbox.instruction).not.toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(sandbox.instructionCustomized).toBe(false);
    expect(data.instruction).toContain('Shared rule.');
    expect(data.instruction).not.toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(data.instructionCustomized).toBe(false);
    expect(createSandboxProfileManifest(data).systemRole).toBe(data.instruction);

    const [manifest] = await getUserSandboxManifests(db, 'user-1');
    expect(manifest.identifier).toBe('lobe-sandbox');
    expect(manifest.systemRole).toContain('Shared rule.');
  });

  it('leaves base none and a saved profile edit off the General instruction', async () => {
    const updatedAt = new Date('2026-11-01T08:00:00.000Z');
    mocks.profiles = [
      profile('general'),
      profile('offline', { instructionBase: 'none', instructionText: 'files only' }),
      profile('custom'),
    ];
    mocks.instructions = new Map([
      ['general', { instruction: 'Edited.', updatedAt }],
      ['custom', { instruction: 'Own text.', updatedAt }],
    ]);
    const profiles = await getUserSandboxProfiles(db, 'user-1');
    const offline = profiles.find((item) => item.id === 'offline');
    const custom = profiles.find((item) => item.id === 'custom');
    expect(offline?.instruction).not.toContain('Edited.');
    expect(offline?.instruction).not.toContain(DEFAULT_SANDBOX_INSTRUCTION);
    expect(offline?.instruction?.endsWith('Profile instructions:\nfiles only\n')).toBe(true);
    expect(custom?.instruction).toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(custom?.instruction).not.toContain('Own text.');
  });

  it('tells the model about a persistent folder only on profiles that have one', async () => {
    const without = composeSandboxInstruction({
      base: 'general',
      description: 'd',
      id: 'data',
      name: 'Data',
    });
    const line = '/persist is your persistent folder: files saved there are kept for you';
    expect(without).not.toContain('persistent folder');

    mocks.profiles = [
      profile('general'),
      profile('data', { persistentFolder: '/persist' }),
      profile('offline', {
        instructionBase: 'none',
        instructionText: 'files only',
        persistentFolder: '/persist',
      }),
    ];
    const profiles = await getUserSandboxProfiles(db, 'user-1');
    const byId = new Map(profiles.map((item) => [item.id, item]));
    expect(byId.get('general')?.instruction).not.toContain('persistent folder');
    expect(byId.get('general')?.persistentFolder).toBeUndefined();
    expect(byId.get('data')?.persistentFolder).toBe('/persist');
    // In the profile's own header, before the General instruction.
    const data = byId.get('data')?.instruction ?? '';
    expect(data.indexOf(line)).toBeGreaterThan(-1);
    expect(data.indexOf(line)).toBeLessThan(data.indexOf(SANDBOX_SHARED_INSTRUCTION));
    expect(byId.get('offline')?.instruction).toContain(line);
    // The header without a folder is exactly as before.
    expect(composeSandboxInstruction({ base: 'none', description: 'd', id: 'x', name: 'X' })).toBe(
      'This tool is the "X" sandbox: d\nIt is a separate container from any other sandbox tool in this conversation. Files move between sandboxes only through exportFile and conversation files.\n',
    );
  });

  it('keeps the starting instructions when the instructions table is missing', async () => {
    mocks.instructionError = { cause: { code: '42P01' } };
    const [general] = await getUserSandboxProfiles(db, 'user-1');
    expect(general.instruction).toContain(SANDBOX_SHARED_INSTRUCTION);
    expect(general.instructionCustomized).toBe(false);

    mocks.instructionError = new Error('relation "sandbox_profile_instructions" does not exist');
    await expect(getUserSandboxProfiles(db, 'user-1')).resolves.toHaveLength(4);
  });

  it('does not swap an edited instruction for the starting text when the read fails', async () => {
    mocks.instructionError = new Error('connection terminated');
    await expect(getUserSandboxProfiles(db, 'user-1')).rejects.toThrow('connection terminated');
    await expect(getUserSandboxManifests(db, 'user-1')).rejects.toThrow('connection terminated');
  });

  it('merges operator profiles with the user choices and hides server details', async () => {
    mocks.choices = new Map([
      ['data', true],
      ['general', false],
    ]);
    const profiles = await getUserSandboxProfiles(db, 'user-1');
    expect(profiles.map(({ available, enabled, id }) => ({ available, enabled, id }))).toEqual([
      { available: true, enabled: false, id: 'general' },
      { available: true, enabled: true, id: 'data' },
      { available: false, enabled: true, id: 'vault' },
      { available: false, enabled: true, id: 'orphan' },
    ]);
    expect(profiles[0]).toMatchObject({ serverName: 'Default' });
    expect(JSON.stringify(profiles)).not.toContain('opensandbox:8090');
    expect(JSON.stringify(profiles)).not.toContain('img:1');
    expect((await getUserEnabledSandboxProfiles(db, 'user-1')).map((item) => item.id)).toEqual([
      'data',
    ]);
  });

  it('falls back to defaultEnabled when the choices table is missing', async () => {
    mocks.readError = new Error('relation "user_sandbox_profiles" does not exist');
    expect((await getUserEnabledSandboxProfiles(db, 'user-1')).map((item) => item.id)).toEqual([
      'general',
    ]);
    await expect(
      resolveSandboxProfileForUser({ db, identifier: 'lobe-sandbox', userId: 'user-1' }),
    ).resolves.toMatchObject({ ok: true, profile: { id: 'general' } });

    mocks.readError = { cause: { code: '42P01' } };
    expect((await getUserEnabledSandboxProfiles(db, 'user-1')).map((item) => item.id)).toEqual([
      'general',
    ]);
  });

  it('does not run a default-on profile when the choices read fails', async () => {
    mocks.readError = new Error('connection terminated');
    await expect(getUserSandboxProfiles(db, 'user-1')).rejects.toThrow('connection terminated');
    await expect(
      resolveSandboxProfileForUser({ db, identifier: 'lobe-sandbox', userId: 'user-1' }),
    ).resolves.toMatchObject({
      message: 'The "general" sandbox cannot run because Sandbox Hub choices could not be read.',
      ok: false,
      reason: 'not_configured',
    });
  });

  it('runs only profiles that are known, configured, keyed and turned on', async () => {
    const resolve = (identifier: string) =>
      resolveSandboxProfileForUser({ db, identifier, userId: 'user-1' });

    expect(await resolve('lobe-sandbox')).toMatchObject({ ok: true, profile: { id: 'general' } });
    expect(await resolve('lobe-code-interpreter')).toMatchObject({ ok: true });
    expect(await resolve('lobe-sandbox--data')).toMatchObject({
      message: 'The "data" sandbox is turned off in Sandbox Hub. Turn it on there to use it.',
      ok: false,
      reason: 'disabled',
    });
    expect(await resolve('lobe-sandbox--vault')).toMatchObject({
      message: 'The "vault" sandbox cannot run: its server "locked" is missing its API key.',
      ok: false,
      reason: 'not_configured',
    });
    expect(await resolve('lobe-sandbox--orphan')).toMatchObject({
      message:
        'The "orphan" sandbox cannot run: its server "gone" is not configured on this server.',
      ok: false,
      reason: 'not_configured',
    });
    expect(await resolve('lobe-sandbox--missing')).toMatchObject({
      message: 'The "missing" sandbox is not configured on this server.',
      reason: 'not_configured',
    });
    expect(await resolve('mcp__x')).toMatchObject({ ok: false, reason: 'unknown' });

    mocks.choices = new Map([
      ['data', true],
      ['general', false],
    ]);
    expect(await resolve('lobe-sandbox--data')).toMatchObject({ ok: true });
    expect(await resolve('lobe-sandbox')).toMatchObject({ ok: false, reason: 'disabled' });
  });
});
