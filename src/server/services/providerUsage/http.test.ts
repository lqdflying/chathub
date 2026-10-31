import { describe, expect, it, vi } from 'vitest';

import { requestUsageJson } from './http';
import { assessUsageUrl, isNonPublicAddress } from './urlPolicy';

const host = (addresses: string[]) => async () => addresses;

describe('isNonPublicAddress', () => {
  it('rejects loopback, private, shared, benchmark, reserved, multicast, NAT64, and metadata addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.1',
      '192.168.0.8',
      '169.254.169.254',
      '100.100.100.200',
      '224.0.0.1',
      '0.0.0.0',
      '100.64.0.1',
      '198.18.0.1',
      '240.0.0.1',
      '::1',
      '::',
      'fd00:ec2::254',
      '64:ff9b::7f00:1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isNonPublicAddress(address), address).toBe(true);
    }
  });

  it('allows a public address', () => {
    expect(isNonPublicAddress('1.1.1.1')).toBe(false);
    expect(isNonPublicAddress('8.8.8.8')).toBe(false);
  });
});

describe('assessUsageUrl', () => {
  const resolveHost = async () => ['1.1.1.1'];

  it('rejects non-http URLs and metadata names', async () => {
    await expect(assessUsageUrl('file:///etc/passwd', { resolveHost })).resolves.toBe(false);
    await expect(
      assessUsageUrl('http://metadata.google.internal/computeMetadata/v1/', { resolveHost }),
    ).resolves.toBe(false);
    await expect(
      assessUsageUrl('http://metadata.google.internal/', {
        allowPrivateHost: 'metadata.google.internal',
        resolveHost,
      }),
    ).resolves.toBe(false);
  });

  it('rejects a public name that resolves to a private address', async () => {
    await expect(
      assessUsageUrl('https://evil.example/user/balance', {
        resolveHost: host(['10.0.0.5']),
      }),
    ).resolves.toBe(false);
  });

  it('rejects when any resolved address is private', async () => {
    await expect(
      assessUsageUrl('https://evil.example/user/balance', {
        resolveHost: host(['1.1.1.1', '127.0.0.1']),
      }),
    ).resolves.toBe(false);
  });

  it('allows the operator proxy host even when it is private', async () => {
    await expect(
      assessUsageUrl('http://10.0.0.5:8080/user/balance', {
        allowPrivateHost: '10.0.0.5',
        resolveHost: async () => {
          throw new Error('should not resolve an explicit operator host');
        },
      }),
    ).resolves.toBe(true);
  });

  it('still allows an operator proxy in shared address space', async () => {
    await expect(
      assessUsageUrl('http://100.101.102.103:8080/user/balance', {
        allowPrivateHost: '100.101.102.103',
        resolveHost: async () => {
          throw new Error('should not resolve an explicit operator host');
        },
      }),
    ).resolves.toBe(true);
  });

  it('still rejects a metadata address used as the operator proxy', async () => {
    await expect(
      assessUsageUrl('http://169.254.169.254/latest/meta-data/', {
        allowPrivateHost: '169.254.169.254',
        resolveHost,
      }),
    ).resolves.toBe(false);
  });
});

describe('requestUsageJson', () => {
  const context = (fetchFn: typeof fetch, allowPrivateHost?: string) => ({
    allowPrivateHost,
    credential: { apiKey: 'sk-test' },
    fetchFn,
    now: new Date('2026-10-31T00:00:00Z'),
    resolveHost: async () => ['1.1.1.1'],
    timeoutMs: 1000,
  });

  it('does not call fetch for a private target', async () => {
    const fetchFn = vi.fn();
    const result = await requestUsageJson(
      context(fetchFn as never),
      'http://127.0.0.1/user/balance',
      { Authorization: 'Bearer sk-test' },
    );
    expect(result).toEqual({ body: undefined, ok: false, status: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not follow redirects', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 302 }));
    const result = await requestUsageJson(
      context(fetchFn as never),
      'https://api.deepseek.com/user/balance',
      { Authorization: 'Bearer sk-test' },
    );
    expect(result).toMatchObject({ ok: false, status: 302 });
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
});
