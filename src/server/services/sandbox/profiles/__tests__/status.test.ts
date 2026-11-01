// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const health = vi.fn();

vi.mock('../../providers/opensandbox/client', () => ({
  OpenSandboxClient: class {
    health = health;
  },
}));
vi.mock('../load', () => ({
  getSandboxProfileCatalog: () => ({
    errors: [],
    profiles: [],
    servers: [
      { apiKey: 'k', id: 'default', name: 'Default', status: 'ok', url: 'http://a' },
      { id: 'locked', name: 'Locked', status: 'misconfigured', url: 'https://b' },
    ],
    source: 'file',
  }),
}));

const { clearSandboxServerHealthCache, getSandboxServerHealth } = await import('../status');

describe('getSandboxServerHealth', () => {
  beforeEach(() => {
    clearSandboxServerHealthCache();
    health.mockReset();
  });

  it('reports each server once per 30 s and never probes a misconfigured one', async () => {
    health.mockResolvedValue('ok');
    expect(await getSandboxServerHealth(1000)).toEqual({ default: 'ok', locked: 'misconfigured' });
    expect(await getSandboxServerHealth(20_000)).toEqual({
      default: 'ok',
      locked: 'misconfigured',
    });
    expect(health).toHaveBeenCalledTimes(1);

    health.mockResolvedValue('unauthorized');
    expect(await getSandboxServerHealth(40_000)).toEqual({
      default: 'unauthorized',
      locked: 'misconfigured',
    });
    expect(health).toHaveBeenCalledTimes(2);
  });
});
