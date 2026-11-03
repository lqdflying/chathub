// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SandboxManifest } from '@/tools/sandbox';

import { type SandboxProfilesEnv, loadSandboxProfiles } from '../load';

const baseEnv: SandboxProfilesEnv = {
  OPENSANDBOX_API_KEY: 'env-key',
  OPENSANDBOX_CPU: '1',
  OPENSANDBOX_IMAGE: 'chathub-sandbox:2',
  OPENSANDBOX_MEMORY: '2Gi',
  OPENSANDBOX_READY_TIMEOUT: 60_000,
  OPENSANDBOX_SERVER_URL: 'http://opensandbox:8090/',
  OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
  OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
};

const withFile = (files: Record<string, string>, env: Partial<SandboxProfilesEnv> = {}) =>
  loadSandboxProfiles({
    env: { ...baseEnv, SANDBOX_PROFILES_FILE: '/etc/chathub/sandbox-profiles.yaml', ...env },
    processEnv: { DATA_SANDBOX_KEY: 'data-key' },
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
  });

describe('loadSandboxProfiles without a profiles file', () => {
  it('builds the general profile from OPENSANDBOX_* with the built-in meta and instruction', () => {
    const catalog = loadSandboxProfiles({ env: baseEnv });
    expect(catalog.source).toBe('env');
    expect(catalog.seeds).toEqual([
      {
        config: {
          avatar: SandboxManifest.meta.avatar,
          defaultEnabled: true,
          description: SandboxManifest.meta.description,
          id: 'general',
          name: SandboxManifest.meta.title,
          server: 'default',
        },
      },
    ]);
    expect(catalog.servers).toEqual([
      {
        apiKey: 'env-key',
        id: 'default',
        name: 'Default',
        proxyEndpoint: 'server',
        status: 'ok',
        url: 'http://opensandbox:8090',
      },
    ]);
    const [general] = catalog.profiles;
    expect(general).toMatchObject({
      avatar: SandboxManifest.meta.avatar,
      defaultEnabled: true,
      description: SandboxManifest.meta.description,
      egress: { mode: 'open' },
      id: 'general',
      identifier: 'lobe-sandbox',
      image: 'chathub-sandbox:2',
      name: SandboxManifest.meta.title,
      serverId: 'default',
    });
    expect(general.instructionBase).toBe('general');
    expect(general.instructionText).toBeUndefined();
  });

  it('limits background jobs to 2 hours unless SANDBOX_JOB_MAX_RUNTIME says otherwise', () => {
    expect(loadSandboxProfiles({ env: baseEnv }).profiles[0].jobMaxRuntimeMs).toBe(7_200_000);
    expect(
      loadSandboxProfiles({ env: { ...baseEnv, SANDBOX_JOB_MAX_RUNTIME: 0 } }).profiles[0]
        .jobMaxRuntimeMs,
    ).toBe(0);
  });

  it('keeps OPENSANDBOX_EGRESS_ALLOW as an allowlist', () => {
    const catalog = loadSandboxProfiles({
      env: { ...baseEnv, OPENSANDBOX_EGRESS_ALLOW: 'pypi.org, files.pythonhosted.org' },
    });
    expect(catalog.profiles[0].egress).toEqual({
      mode: 'allowlist',
      targets: ['pypi.org', 'files.pythonhosted.org'],
    });
  });

  it('configures nothing without a server URL or image', () => {
    expect(loadSandboxProfiles({ env: { ...baseEnv, OPENSANDBOX_IMAGE: undefined } }).source).toBe(
      'none',
    );
    expect(
      loadSandboxProfiles({ env: { ...baseEnv, OPENSANDBOX_SERVER_URL: undefined } }).profiles,
    ).toEqual([]);
  });
});

describe('loadSandboxProfiles with a profiles file', () => {
  const yaml = `
version: 1
servers:
  - id: gvisor
    name: Isolated box
    url: https://sandbox.example.com
    apiKeyEnv: DATA_SANDBOX_KEY
profiles:
  - id: general
    name: Sandbox
    description: General Linux sandbox
  - id: data
    name: Data science
    description: Python with the data stack
    server: gvisor
    image: registry.example.com/sandbox-data:3
    cpu: "2"
    memory: 4Gi
    egress: [pypi.org]
    instruction:
      file: instructions/data.md
  - id: offline
    name: Offline
    description: No network
    egress: none
    defaultEnabled: true
    instruction:
      base: none
      text: Only use the files you are given.
`;

  it('resolves servers, defaults, egress and instruction files relative to the profiles file', () => {
    const catalog = withFile({
      '/etc/chathub/instructions/data.md': 'Prefer polars over pandas.',
      '/etc/chathub/sandbox-profiles.yaml': yaml,
    });

    expect(catalog.errors).toEqual([]);
    expect(catalog.source).toBe('file');
    expect(catalog.servers.map((server) => server.id).sort()).toEqual(['default', 'gvisor']);
    expect(catalog.servers.find((server) => server.id === 'gvisor')).toEqual({
      apiKey: 'data-key',
      id: 'gvisor',
      name: 'Isolated box',
      proxyEndpoint: 'server',
      status: 'ok',
      url: 'https://sandbox.example.com',
    });

    const [general, data, offline] = catalog.profiles;
    expect(general).toMatchObject({ defaultEnabled: true, identifier: 'lobe-sandbox' });
    expect(general.instructionBase).toBe('general');
    expect(general.instructionText).toBeUndefined();

    expect(data).toMatchObject({
      cpu: '2',
      defaultEnabled: false,
      egress: { mode: 'allowlist', targets: ['pypi.org'] },
      identifier: 'lobe-sandbox--data',
      image: 'registry.example.com/sandbox-data:3',
      memory: '4Gi',
      serverId: 'gvisor',
    });
    expect(data.instructionBase).toBe('general');
    expect(data.instructionText).toBe('Prefer polars over pandas.');

    expect(offline).toMatchObject({
      defaultEnabled: true,
      egress: { mode: 'none' },
      image: 'chathub-sandbox:2',
      serverId: 'default',
    });
    expect(offline.instructionBase).toBe('none');
    expect(offline.instructionText).toBe('Only use the files you are given.');
  });

  it('reads proxyEndpoint per server', () => {
    const catalog = withFile({
      '/etc/chathub/sandbox-profiles.yaml': `version: 1
servers:
  - {id: remote, url: "https://sandbox.example.com", proxyEndpoint: baseUrl}
profiles:
  - {id: data, name: Data, description: Data, server: remote}
`,
    });
    expect(catalog.servers.find((server) => server.id === 'remote')?.proxyEndpoint).toBe('baseUrl');
  });

  it('reads a per-profile job runtime limit, falling back to SANDBOX_JOB_MAX_RUNTIME', () => {
    const catalog = withFile(
      {
        '/etc/chathub/sandbox-profiles.yaml': `version: 1
profiles:
  - {id: general, name: Sandbox, description: General}
  - {id: train, name: Training, description: Long runs, jobMaxRuntimeMs: 21600000}
  - {id: quick, name: Quick, description: No jobs, jobMaxRuntimeMs: 0}
`,
      },
      { SANDBOX_JOB_MAX_RUNTIME: 3_600_000 },
    );
    expect(catalog.profiles.map((profile) => profile.jobMaxRuntimeMs)).toEqual([
      3_600_000, 21_600_000, 0,
    ]);
  });

  it('accepts a servers-only file and lists every server, used or not', () => {
    const catalog = withFile({
      '/etc/chathub/sandbox-profiles.yaml': `version: 1
servers:
  - {id: remote, url: "https://sandbox.example.com"}
`,
    });
    expect(catalog).toMatchObject({ errors: [], profiles: [], seeds: [], source: 'file' });
    expect(catalog.servers.map((server) => server.id).sort()).toEqual(['default', 'remote']);
  });

  it('resolves registry logins from the environment and warns about unset ones', () => {
    const catalog = loadSandboxProfiles({
      env: { ...baseEnv, SANDBOX_PROFILES_FILE: '/p.yaml' },
      processEnv: { REG_PASS: 'secret', REG_USER: 'robot' },
      readFile: () => `version: 1
servers:
  - id: remote
    url: https://sandbox.example.com
    registries:
      - {host: IMG.example.net, usernameEnv: REG_USER, passwordEnv: REG_PASS}
      - {host: other.example.net, usernameEnv: OTHER_USER, passwordEnv: OTHER_PASS}
`,
    });
    expect(catalog.errors).toEqual([]);
    expect(catalog.servers.find((server) => server.id === 'remote')?.registries).toEqual([
      { host: 'img.example.net', password: 'secret', username: 'robot' },
    ]);
    expect(catalog.warnings).toEqual([
      'servers.remote.registries.other.example.net: OTHER_USER is unset; images from other.example.net are pulled without a login',
    ]);
    // A server without logins has no registries field at all.
    expect(catalog.servers.find((server) => server.id === 'default')).not.toHaveProperty(
      'registries',
    );
  });

  it('keeps the raw file profiles as Sandbox Hub seeds, with instruction files read', () => {
    const catalog = withFile({
      '/etc/chathub/data.md': 'Prefer polars.',
      '/etc/chathub/sandbox-profiles.yaml': `version: 1
profiles:
  - {id: general, name: Sandbox, description: General}
  - {id: data, name: Data, description: Data, cpu: "2", instruction: {file: data.md}}
`,
    });
    expect(catalog.seeds).toEqual([
      { config: expect.objectContaining({ id: 'general', server: 'default' }) },
      {
        config: expect.objectContaining({ cpu: '2', id: 'data' }),
        text: 'Prefer polars.',
      },
    ]);
    expect(catalog.seeds[1].config).not.toHaveProperty('memory');
  });

  it('reads JSON too', () => {
    const catalog = withFile({
      '/etc/chathub/sandbox-profiles.yaml': JSON.stringify({
        profiles: [{ description: 'General', id: 'general', name: 'Sandbox' }],
        version: 1,
      }),
    });
    expect(catalog.source).toBe('file');
    expect(catalog.profiles).toHaveLength(1);
  });

  it('marks a server whose apiKeyEnv is unset as misconfigured', () => {
    const catalog = loadSandboxProfiles({
      env: { ...baseEnv, SANDBOX_PROFILES_FILE: '/p.yaml' },
      processEnv: {},
      readFile: () => yaml.replace('file: instructions/data.md', 'text: hi'),
    });
    expect(catalog.servers.find((server) => server.id === 'gvisor')?.status).toBe('misconfigured');
  });

  it.each([
    [
      'a duplicate id',
      'profiles:\n  - {id: a, name: A, description: x}\n  - {id: a, name: B, description: y}',
    ],
    ['a bad id', 'profiles:\n  - {id: Bad_Id, name: A, description: x}'],
    ['a too long id', `profiles:\n  - {id: ${'a'.repeat(17)}, name: A, description: x}`],
    ['an unknown key', 'profiles:\n  - {id: a, name: A, description: x, gpu: 1}'],
    [
      'a literal api key',
      'servers:\n  - {id: s, url: "https://x.example", apiKey: secret}\nprofiles:\n  - {id: a, name: A, description: x, server: s}',
    ],
    [
      'file and text together',
      'profiles:\n  - {id: a, name: A, description: x, instruction: {file: a.md, text: b}}',
    ],
  ])('rejects %s', (_case, body) => {
    const catalog = withFile({ '/etc/chathub/sandbox-profiles.yaml': `version: 1\n${body}` });
    expect(catalog.source).toBe('none');
    expect(catalog.profiles).toEqual([]);
    expect(catalog.errors.length).toBeGreaterThan(0);
  });

  it('configures nothing when one profile is broken, instead of running the rest', () => {
    const catalog = withFile({
      '/etc/chathub/sandbox-profiles.yaml': `version: 1
profiles:
  - {id: general, name: Sandbox, description: General}
  - {id: data, name: Data, description: Data, server: missing}
`,
    });
    expect(catalog.source).toBe('none');
    expect(catalog.errors).toEqual(['profiles.data.server: unknown server "missing"']);
  });

  it('reports a missing instruction file and an oversized instruction', () => {
    expect(
      withFile({
        '/etc/chathub/sandbox-profiles.yaml':
          'version: 1\nprofiles:\n  - {id: a, name: A, description: x, instruction: {file: nope.md}}',
      }).errors[0],
    ).toContain('profiles.a.instruction.file: cannot read /etc/chathub/nope.md');

    expect(
      withFile({
        '/etc/chathub/big.md': 'x'.repeat(32 * 1024 + 1),
        '/etc/chathub/sandbox-profiles.yaml':
          'version: 1\nprofiles:\n  - {id: a, name: A, description: x, instruction: {file: big.md}}',
      }).errors,
    ).toEqual(['profiles.a.instruction: larger than 32768 bytes']);
  });

  it('needs an image from the profile or OPENSANDBOX_IMAGE', () => {
    const catalog = withFile(
      {
        '/etc/chathub/sandbox-profiles.yaml':
          'version: 1\nprofiles:\n  - {id: a, name: A, description: x}',
      },
      { OPENSANDBOX_IMAGE: undefined },
    );
    expect(catalog.errors).toEqual(['profiles.a.image: no image and OPENSANDBOX_IMAGE is unset']);
  });

  it('configures nothing when the file cannot be read or parsed', () => {
    expect(withFile({}).errors[0]).toContain('cannot read /etc/chathub/sandbox-profiles.yaml');
    expect(
      withFile({ '/etc/chathub/sandbox-profiles.yaml': 'version: 1\nprofiles: [' }).source,
    ).toBe('none');
  });
});
