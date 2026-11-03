// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SandboxManifest, createSandboxProfileManifest } from '@/tools/sandbox';

import type { SandboxProfilesEnv } from '../load';
import type { SandboxProfileCatalog } from '../schema';

const state = vi.hoisted(() => ({
  env: undefined as unknown as SandboxProfilesEnv,
  file: undefined as unknown as SandboxProfileCatalog,
  listError: undefined as unknown,
  rows: [] as Array<Record<string, any>>,
  seedCalls: 0,
}));

vi.mock('@/database/models/sandboxHubProfile', () => ({
  SandboxHubProfileModel: class {
    list = async () => {
      if (state.listError) throw state.listError;
      return state.rows;
    };
    seed = async (seeds: Array<Record<string, unknown>>) => {
      state.seedCalls += 1;
      const known = new Set(state.rows.map((row) => row.id));
      const added = seeds.filter((seed) => !known.has(seed.id as string));
      state.rows = [...state.rows, ...added.map((seed, position) => ({ ...seed, position }))];
      return added.length;
    };
  },
}));
vi.mock('../load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../load')>();
  return {
    ...actual,
    getSandboxFileCatalog: () => state.file,
    readSandboxProfilesEnv: () => state.env,
  };
});

const { loadSandboxProfiles } = await vi.importActual<typeof import('../load')>('../load');
const { findSandboxProfile, getSandboxProfileCatalog, hubFieldsToConfig, resetSandboxHubWarnings } =
  await import('../hub');

const db = {} as never;

const baseEnv: SandboxProfilesEnv = {
  OPENSANDBOX_API_KEY: 'k',
  OPENSANDBOX_CPU: '1',
  OPENSANDBOX_IMAGE: 'chathub-sandbox:2',
  OPENSANDBOX_MEMORY: '2Gi',
  OPENSANDBOX_READY_TIMEOUT: 60_000,
  OPENSANDBOX_SERVER_URL: 'http://opensandbox:8090',
  OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
  OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
};

const fileCatalog = (yaml: string, files: Record<string, string> = {}) =>
  loadSandboxProfiles({
    env: { ...baseEnv, SANDBOX_PROFILES_FILE: '/etc/chathub/profiles.yaml' },
    processEnv: { REMOTE_KEY: 'rk' },
    readFile: (path) => {
      if (path === '/etc/chathub/profiles.yaml') return yaml;
      if (path in files) return files[path];
      throw new Error(`ENOENT: ${path}`);
    },
  });

const hubRow = (id: string, extra: Record<string, unknown> = {}) => ({
  avatar: null,
  cpu: null,
  defaultEnabled: false,
  description: `${id} profile`,
  egress: null,
  id,
  image: null,
  instructionBase: 'general',
  instructionText: null,
  jobMaxRuntimeMs: null,
  memory: null,
  name: id,
  readyTimeoutMs: null,
  serverId: 'default',
  sessionIdleTimeoutMs: null,
  sessionMaxLifetimeMs: null,
  ...extra,
});

describe('Sandbox Hub profile catalog', () => {
  beforeEach(() => {
    state.env = baseEnv;
    state.file = loadSandboxProfiles({ env: baseEnv });
    state.listError = undefined;
    state.rows = [];
    state.seedCalls = 0;
    resetSandboxHubWarnings();
    vi.restoreAllMocks();
  });

  it('imports the OPENSANDBOX_* profile once and keeps its tool and prompt bytes', async () => {
    const catalog = await getSandboxProfileCatalog(db);
    expect(catalog.source).toBe('hub');
    expect(state.rows).toHaveLength(1);
    // Unset fields stay null, so later OPENSANDBOX_* changes still apply.
    expect(state.rows[0]).toMatchObject({
      cpu: null,
      defaultEnabled: true,
      egress: null,
      id: 'general',
      image: null,
      instructionText: null,
      serverId: 'default',
    });

    const [general] = catalog.profiles;
    expect(general).toEqual(state.file.profiles[0]);
    expect(
      createSandboxProfileManifest({ ...general, instruction: SandboxManifest.systemRole }),
    ).toEqual(SandboxManifest);

    await getSandboxProfileCatalog(db);
    expect(state.seedCalls).toBe(1);
  });

  it('imports file profiles with their instruction file text, then ignores the file', async () => {
    state.file = fileCatalog(
      `version: 1
servers:
  - {id: remote, url: "https://sandbox.example.com", apiKeyEnv: REMOTE_KEY}
profiles:
  - {id: general, name: Sandbox, description: General}
  - id: data
    name: Data
    description: Python with the data stack
    server: remote
    cpu: "2"
    egress: [pypi.org]
    jobMaxRuntimeMs: 21600000
    instruction: {file: data.md}
`,
      { '/etc/chathub/data.md': 'Prefer polars.' },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const catalog = await getSandboxProfileCatalog(db);
    expect(state.rows.map((row) => row.id)).toEqual(['general', 'data']);
    expect(state.rows[1]).toMatchObject({
      cpu: '2',
      egress: ['pypi.org'],
      instructionText: 'Prefer polars.',
      jobMaxRuntimeMs: 21_600_000,
      memory: null,
      serverId: 'remote',
    });
    expect(catalog.profiles).toEqual(state.file.profiles);
    expect(catalog.servers.map((server) => server.id).sort()).toEqual(['default', 'remote']);
    expect(warn).not.toHaveBeenCalled();

    // Rows exist now: the file's profiles are ignored, said once per process.
    state.rows[1].cpu = '4';
    const again = await getSandboxProfileCatalog(db);
    await getSandboxProfileCatalog(db);
    expect(again.profiles[1].cpu).toBe('4');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(state.seedCalls).toBe(1);
  });

  it('falls back to the file while the Hub table is missing, and raises other read errors', async () => {
    state.listError = { cause: { code: '42P01' } };
    await expect(getSandboxProfileCatalog(db)).resolves.toBe(state.file);

    state.listError = new Error('relation "sandbox_hub_profiles" does not exist');
    await expect(getSandboxProfileCatalog(db)).resolves.toBe(state.file);

    state.listError = new Error('connection terminated');
    await expect(getSandboxProfileCatalog(db)).rejects.toThrow('connection terminated');
  });

  it('keeps a profile whose server is gone and leaves out one with no image', async () => {
    state.rows = [
      hubRow('orphan', { serverId: 'gone' }),
      hubRow('noimage'),
      hubRow('pinned', { image: 'pinned:1' }),
    ];
    state.env = { ...baseEnv, OPENSANDBOX_IMAGE: undefined };

    const { profiles } = await getSandboxProfileCatalog(db);
    expect(profiles.map((profile) => profile.id)).toEqual(['pinned']);

    state.env = baseEnv;
    const again = await getSandboxProfileCatalog(db);
    expect(again.profiles.map((profile) => [profile.id, profile.serverId])).toEqual([
      ['orphan', 'gone'],
      ['noimage', 'default'],
      ['pinned', 'default'],
    ]);
    expect((await findSandboxProfile(db, 'pinned'))?.image).toBe('pinned:1');
    expect(await findSandboxProfile(db, 'missing')).toBeUndefined();
  });

  it('checks Hub rows with the profiles-file rules', () => {
    expect(
      hubFieldsToConfig(hubRow('data', { egress: 'none', jobMaxRuntimeMs: 0 }) as any),
    ).toMatchObject({
      config: { egress: 'none', id: 'data', jobMaxRuntimeMs: 0, server: 'default' },
      ok: true,
    });
    expect(hubFieldsToConfig(hubRow('Bad_Id') as any)).toMatchObject({
      error: expect.stringContaining('id: profile id must be'),
      ok: false,
    });
    expect(
      hubFieldsToConfig(hubRow('data', { instructionText: 'x'.repeat(32 * 1024 + 1) }) as any),
    ).toMatchObject({ error: 'instruction: larger than 32768 bytes', ok: false });
  });
});
