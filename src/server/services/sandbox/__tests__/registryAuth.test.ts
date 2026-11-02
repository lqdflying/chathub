// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => [] as Array<Record<string, unknown> | undefined>);

vi.mock('../providers/opensandbox/provider', () => ({
  OpenSandboxProvider: class {
    constructor(options?: Record<string, unknown>) {
      created.push(options);
    }
  },
}));

const { imageRegistryHost, registryLoginFor } = await import('../registryAuth');
const { getSandboxProvider } = await import('../registry');

describe('registry logins', () => {
  it.each([
    ['img.aksg.net/chathub-sandbox/chathub-sandbox-python:latest', 'img.aksg.net'],
    ['IMG.AKSG.NET/team/app:1', 'img.aksg.net'],
    ['registry.example:5000/app:1', 'registry.example:5000'],
    ['localhost/app', 'localhost'],
    ['localhost:5000/app', 'localhost:5000'],
    ['python:3.12', 'docker.io'],
    ['library/python:3.12', 'docker.io'],
    ['opensandbox/server:release-1.1.0', 'docker.io'],
    ['index.docker.io/library/python', 'docker.io'],
    ['ghcr.io/org/image@sha256:abc', 'ghcr.io'],
  ])('reads the registry of %s as %s', (image, host) => {
    expect(imageRegistryHost(image)).toBe(host);
  });

  it('picks the login for the image registry only', () => {
    const registries = [
      { host: 'img.aksg.net', password: 'p1', username: 'u1' },
      { host: 'docker.io', password: 'p2', username: 'u2' },
    ];
    expect(registryLoginFor('img.aksg.net/a/b:1', registries)?.username).toBe('u1');
    expect(registryLoginFor('python:3.12', registries)?.username).toBe('u2');
    expect(registryLoginFor('ghcr.io/a/b', registries)).toBeUndefined();
    expect(registryLoginFor('python:3.12')).toBeUndefined();
  });

  it('gives a profile provider the login for its image', () => {
    const profile = {
      cpu: '1',
      egress: { mode: 'open' },
      id: 'data',
      image: 'img.aksg.net/sandbox/python:1',
      memory: '1Gi',
      readyTimeoutMs: 60_000,
      sessionIdleTimeoutMs: 1_800_000,
      sessionMaxLifetimeMs: 0,
    } as any;
    const server = {
      id: 'remote',
      proxyEndpoint: 'server',
      registries: [{ host: 'img.aksg.net', password: 'secret', username: 'robot' }],
      status: 'ok',
      url: 'https://sandbox.example.com',
    } as any;

    getSandboxProvider(profile, server);
    expect(created.at(-1)).toMatchObject({ imageAuth: { password: 'secret', username: 'robot' } });

    getSandboxProvider({ ...profile, image: 'python:3.12' }, server);
    expect(created.at(-1)).not.toHaveProperty('imageAuth');
  });
});
