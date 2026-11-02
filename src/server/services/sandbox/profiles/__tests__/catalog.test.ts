// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choices: new Map<string, boolean>(),
  instructionError: undefined as unknown,
  instructions: new Map<string, { instruction: string; updatedAt: Date }>(),
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
  instruction: `${id} instruction`,
  memory: '2Gi',
  name: id,
  readyTimeoutMs: 60_000,
  serverId: 'default',
  sessionIdleTimeoutMs: 1_800_000,
  sessionMaxLifetimeMs: 0,
  ...extra,
});

vi.mock('../load', () => {
  const servers = [
    { apiKey: 'k', id: 'default', name: 'Default', status: 'ok', url: 'http://opensandbox:8090' },
    { id: 'locked', name: 'Locked', status: 'misconfigured', url: 'https://locked.example' },
  ];
  const profiles = [
    profile('general'),
    profile('data'),
    profile('vault', { defaultEnabled: true, serverId: 'locked' }),
  ];
  return {
    findSandboxServer: (id: string) => servers.find((server) => server.id === id),
    getSandboxProfileCatalog: () => ({ errors: [], profiles, servers, source: 'file' }),
    isSandboxProfileUsable: (item: { serverId: string }) =>
      servers.find((server) => server.id === item.serverId)?.status === 'ok',
  };
});

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
    mocks.readError = undefined;
  });

  it('uses the starting instruction until an admin edits it', async () => {
    const [general] = await getUserSandboxProfiles(db, 'user-1');
    expect(general).toMatchObject({
      instruction: 'general instruction',
      instructionCustomized: false,
    });
    expect(general).not.toHaveProperty('instructionUpdatedAt');

    const updatedAt = new Date('2026-11-01T08:00:00.000Z');
    mocks.instructions = new Map([['general', { instruction: 'Edited.', updatedAt }]]);
    const [edited, data] = await getUserSandboxProfiles(db, 'user-1');
    expect(edited).toMatchObject({
      instruction: 'Edited.',
      instructionCustomized: true,
      instructionUpdatedAt: '2026-11-01T08:00:00.000Z',
    });
    expect(data).toMatchObject({ instruction: 'data instruction', instructionCustomized: false });

    const [manifest] = await getUserSandboxManifests(db, 'user-1');
    expect(manifest.identifier).toBe('lobe-sandbox');
    expect(manifest.systemRole).toBe('Edited.');
  });

  it('keeps the starting instructions when the instructions table is missing', async () => {
    mocks.instructionError = { cause: { code: '42P01' } };
    const [general] = await getUserSandboxProfiles(db, 'user-1');
    expect(general).toMatchObject({
      instruction: 'general instruction',
      instructionCustomized: false,
    });

    mocks.instructionError = new Error('relation "sandbox_profile_instructions" does not exist');
    await expect(getUserSandboxProfiles(db, 'user-1')).resolves.toHaveLength(3);
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
