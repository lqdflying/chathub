// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryXaiDeviceHandoffStore } from './handoffStore';
import { XaiOAuthService } from './oauth';
import { createMemoryXaiOAuthTokenStore } from './tokenStore';

const makeJwt = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
};

describe('XaiOAuthService device polling', () => {
  const fetchFn = vi.fn();
  let now = 1_700_000_000_000;
  const crypto = {
    decrypt: vi.fn(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    })),
    encrypt: vi.fn(async (value: string) => `enc:${value}`),
  };
  let handoffStore: ReturnType<typeof createMemoryXaiDeviceHandoffStore>;
  let tokenStore: ReturnType<typeof createMemoryXaiOAuthTokenStore>;

  const service = () =>
    new XaiOAuthService({} as any, {
      crypto,
      fetchFn: fetchFn as any,
      handoffStore,
      now: () => now,
      tokenStore,
    });

  const seedHandoff = (overrides?: Record<string, unknown>) => {
    handoffStore.seed({
      client: 'xai-oauth',
      id: 'handoff-1',
      payload: {
        deviceCode: 'device-1',
        expiresAt: now + 120_000,
        intervalMs: 10_000,
        nextPollAt: now,
        tokenEndpoint: 'https://auth.x.ai/oauth/token',
        userCode: 'ABCD',
        userId: 'user-1',
        ...overrides,
      },
    });
  };

  beforeEach(() => {
    now = 1_700_000_000_000;
    fetchFn.mockReset();
    handoffStore = createMemoryXaiDeviceHandoffStore();
    tokenStore = createMemoryXaiOAuthTokenStore();
  });

  it('uses a 10s vendor interval and does not poll early', async () => {
    fetchFn
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            device_authorization_endpoint: 'https://auth.x.ai/oauth/device',
            token_endpoint: 'https://auth.x.ai/oauth/token',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            device_code: 'device-1',
            expires_in: 300,
            interval: 10,
            user_code: 'ABCD',
            verification_uri: 'https://auth.x.ai/device',
          }),
      })
      .mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'authorization_pending' }),
      });

    const started = await service().startDeviceLogin('user-1');
    expect(started.intervalMs).toBe(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await expect(service().pollDeviceLogin('user-1', started.handoffId)).resolves.toEqual({
      intervalMs: 10_000,
      nextDelayMs: 10_000,
      status: 'pending',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    now += 10_000;
    await expect(service().pollDeviceLogin('user-1', started.handoffId)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.invocationCallOrder[2]).toBeGreaterThan(fetchFn.mock.invocationCallOrder[1]);
  });

  it('defaults to a 5s interval when the vendor omits interval', async () => {
    fetchFn
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            device_authorization_endpoint: 'https://auth.x.ai/oauth/device',
            token_endpoint: 'https://auth.x.ai/oauth/token',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            device_code: 'device-1',
            expires_in: 300,
            user_code: 'ABCD',
            verification_uri: 'https://auth.x.ai/device',
          }),
      });

    const started = await service().startDeviceLogin('user-1');
    expect(started.intervalMs).toBe(5_000);
  });

  it('increases the interval on successive slow_down responses and serializes redemption', async () => {
    seedHandoff();
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'slow_down' }),
    });

    const first = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(first).toEqual({ intervalMs: 15_000, nextDelayMs: 15_000, status: 'pending' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const early = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(early.status).toBe('pending');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 15_000;
    const second = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(second).toEqual({ intervalMs: 20_000, nextDelayMs: 20_000, status: 'pending' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not start a second vendor exchange while one is in flight', async () => {
    seedHandoff();
    let release!: (value: { ok: false; status: number; text: () => Promise<string> }) => void;
    fetchFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = service().pollDeviceLogin('user-1', 'handoff-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toMatchObject({
      status: 'pending',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    release({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });
    await expect(first).resolves.toMatchObject({ status: 'pending' });
  });

  it('releases the claim when the reservation write fails so a later poll can retry', async () => {
    seedHandoff();
    handoffStore.failNextClaim(new Error('temporary database failure'));
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });

    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).rejects.toThrow(
      'temporary database failure',
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(handoffStore.getRow('handoff-1')?.payload.pollOwner).toBeUndefined();

    now += 60_000;
    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toMatchObject({
      status: 'pending',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps redemption exclusive across distinct service instances sharing one store', async () => {
    seedHandoff({ intervalMs: 5_000 });
    let complete!: (value: { ok: false; status: number; text: () => Promise<string> }) => void;
    fetchFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });

    const first = service().pollDeviceLogin('user-1', 'handoff-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    now += 6_000;
    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toMatchObject({
      status: 'pending',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    complete({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });
    await first;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('increases and persists backoff after repeated token request timeouts', async () => {
    seedHandoff({ intervalMs: 5_000 });
    fetchFn.mockImplementation(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });

    const first = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(first).toEqual({ intervalMs: 10_000, nextDelayMs: 10_000, status: 'pending' });
    expect(handoffStore.getRow('handoff-1')?.payload.intervalMs).toBe(10_000);
    expect(handoffStore.getRow('handoff-1')?.payload.nextPollAt).toBe(now + 10_000);
    expect(handoffStore.getRow('handoff-1')?.payload.pollOwner).toBeUndefined();

    const early = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(early.status).toBe('pending');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 10_000;
    const second = await service().pollDeviceLogin('user-1', 'handoff-1');
    expect(second).toEqual({ intervalMs: 15_000, nextDelayMs: 15_000, status: 'pending' });
    expect(handoffStore.getRow('handoff-1')?.payload.intervalMs).toBe(15_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['access_denied', 'denied', 'access_denied'],
    ['authorization_denied', 'denied', 'authorization_denied'],
    ['invalid_client', 'denied', 'invalid_client'],
    ['expired_token', 'expired', undefined],
  ] as const)('treats HTTP 400 %s as terminal', async (error, status, message) => {
    seedHandoff();
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error }),
    });

    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toEqual(
      message ? { message, status } : { status },
    );
    expect(handoffStore.getRow('handoff-1')).toBeUndefined();
  });

  it('keeps authorization_pending as pending and retains the handoff', async () => {
    seedHandoff();
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });

    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toMatchObject({
      status: 'pending',
    });
    expect(handoffStore.getRow('handoff-1')).toBeTruthy();
  });

  it('expires the handoff when the vendor deadline elapses', async () => {
    seedHandoff({ expiresAt: now - 1 });
    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toEqual({
      status: 'expired',
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(handoffStore.getRow('handoff-1')).toBeUndefined();
  });

  it('stores tokens when the device grant succeeds', async () => {
    seedHandoff();
    const accessToken = makeJwt({ email: 'grok@example.com', exp: Math.floor(now / 1000) + 3600 });
    fetchFn.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: 'refresh-1',
        }),
    });

    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toMatchObject({
      connected: true,
      status: 'connected',
    });
    expect(handoffStore.getRow('handoff-1')).toBeUndefined();
    expect(await tokenStore.findByUserId('user-1')).toBeTruthy();
  });
});
