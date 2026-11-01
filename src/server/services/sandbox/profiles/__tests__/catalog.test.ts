// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choices: new Map<string, boolean>(),
  fail: false,
}));

vi.mock('@/database/models/sandboxProfile', () => ({
  SandboxProfileModel: class {
    find = async (id: string) => {
      if (mocks.fail) throw new Error('relation "user_sandbox_profiles" does not exist');
      return mocks.choices.get(id);
    };
    list = async () => {
      if (mocks.fail) throw new Error('relation "user_sandbox_profiles" does not exist');
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

const { getUserEnabledSandboxProfiles, getUserSandboxProfiles, resolveSandboxProfileForUser } =
  await import('../catalog');

const db = {} as never;

describe('Sandbox Hub catalog', () => {
  beforeEach(() => {
    mocks.choices = new Map();
    mocks.fail = false;
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

  it('falls back to defaultEnabled when the choices cannot be read', async () => {
    mocks.fail = true;
    expect((await getUserEnabledSandboxProfiles(db, 'user-1')).map((item) => item.id)).toEqual([
      'general',
    ]);
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
