import { describe, expect, it } from 'vitest';

import { parseAllowlist, toFormState, toSettingsInput } from './settingsForm';

const item = {
  avatar: null,
  cpu: '2',
  defaultEnabled: true,
  deletable: true,
  description: 'Python with the data stack',
  egress: ['pypi.org', 'files.pythonhosted.org'],
  id: 'data',
  image: 'img.example.net/data:3',
  imageStatus: 'unknown' as const,
  instructionBase: 'none' as const,
  instructionText: 'Prefer polars.',
  jobMaxRuntimeMs: 21_600_000,
  memory: null,
  name: 'Data',
  readyTimeoutMs: 120_000,
  serverId: 'remote',
  sessionIdleTimeoutMs: 3_600_000,
  sessionMaxLifetimeMs: null,
  updatedAt: '2026-11-02T08:00:00.000Z',
};

describe('profile settings form', () => {
  it('shows settings in minutes and seconds, blank where inherited', () => {
    expect(toFormState(item, 'default')).toEqual({
      allowlist: 'pypi.org\nfiles.pythonhosted.org',
      avatar: '',
      cpu: '2',
      defaultEnabled: true,
      description: 'Python with the data stack',
      id: 'data',
      idleMinutes: '60',
      image: 'img.example.net/data:3',
      instructionBase: 'none',
      instructionText: 'Prefer polars.',
      jobMinutes: '360',
      maxLifetimeMinutes: '',
      memory: '',
      name: 'Data',
      network: 'allowlist',
      readySeconds: '120',
      serverId: 'remote',
    });
    expect(toFormState(undefined, 'default')).toMatchObject({
      id: '',
      network: 'inherit',
      serverId: 'default',
    });
  });

  it('round-trips an existing profile', () => {
    const result = toSettingsInput(toFormState(item, 'default'));
    expect(result).toEqual({
      input: {
        avatar: null,
        cpu: '2',
        defaultEnabled: true,
        description: 'Python with the data stack',
        egress: ['pypi.org', 'files.pythonhosted.org'],
        image: 'img.example.net/data:3',
        instructionBase: 'none',
        instructionText: 'Prefer polars.',
        jobMaxRuntimeMs: 21_600_000,
        memory: null,
        name: 'Data',
        readyTimeoutMs: 120_000,
        serverId: 'remote',
        sessionIdleTimeoutMs: 3_600_000,
        sessionMaxLifetimeMs: null,
      },
      ok: true,
    });
  });

  it('maps network choices and blank numbers', () => {
    const base = toFormState(item, 'default');
    const open = toSettingsInput({ ...base, jobMinutes: '0', network: 'open' });
    expect(open.ok && open.input).toMatchObject({ egress: 'open', jobMaxRuntimeMs: 0 });
    const inherit = toSettingsInput({ ...base, idleMinutes: ' ', network: 'inherit' });
    expect(inherit.ok && inherit.input).toMatchObject({ egress: null, sessionIdleTimeoutMs: null });
    expect(parseAllowlist('pypi.org, files.pythonhosted.org\npypi.org')).toEqual([
      'pypi.org',
      'files.pythonhosted.org',
    ]);
  });

  it('points at the field to fix', () => {
    const base = toFormState(item, 'default');
    expect(toSettingsInput({ ...base, name: ' ' })).toEqual({
      error: { field: 'name' },
      ok: false,
    });
    expect(toSettingsInput({ ...base, idleMinutes: '-1' })).toEqual({
      error: { field: 'idleMinutes' },
      ok: false,
    });
    expect(toSettingsInput({ ...base, readySeconds: 'soon' })).toEqual({
      error: { field: 'readySeconds' },
      ok: false,
    });
    expect(toSettingsInput({ ...base, allowlist: ' , ' })).toEqual({
      error: { field: 'allowlist' },
      ok: false,
    });
  });
});
