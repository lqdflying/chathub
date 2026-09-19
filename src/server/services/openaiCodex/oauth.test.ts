// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { oauthHandoffs } from '@/database/schemas/oidc';

import { OpenAICodexTransientRefreshError } from './errors';
import { OpenAICodexOAuthService } from './oauth';
import { createMemoryOpenAICodexTokenStore } from './tokenStore';

const makeJwt = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
};

const accessToken = makeJwt({
  'https://api.openai.com/auth': {
    chatgpt_account_id: 'acct_1',
    chatgpt_plan_type: 'plus',
  },
  'https://api.openai.com/profile': { email: 'plus@example.com' },
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const loginAccessToken = makeJwt({
  'https://api.openai.com/auth': {
    chatgpt_account_id: 'acct_2',
    chatgpt_plan_type: 'pro',
  },
  'https://api.openai.com/profile': { email: 'pro@example.com' },
  exp: Math.floor(Date.now() / 1000) + 3600,
});

describe('OpenAICodexOAuthService', () => {
  const handoffs: any[] = [];
  const fetchFn = vi.fn();
  const crypto = {
    decrypt: vi.fn(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    })),
    encrypt: vi.fn(async (value: string) => `enc:${value}`),
  };
  let tokenStore: ReturnType<typeof createMemoryOpenAICodexTokenStore>;

  const db = {
    delete: vi.fn((table: unknown) => ({
      where: async () => {
        if (table === oauthHandoffs) handoffs.length = 0;
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: async (row: any) => {
        if (table === oauthHandoffs) handoffs.push(row);
      },
    })),
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: async () => (table === oauthHandoffs ? [...handoffs] : []),
      }),
    })),
  };

  const service = (overrides?: ConstructorParameters<typeof OpenAICodexOAuthService>[1]) =>
    new OpenAICodexOAuthService(db as any, {
      crypto,
      fetchFn: fetchFn as any,
      tokenStore,
      ...overrides,
    });

  const seedExpiringSession = async (refreshToken = 'old-refresh') => {
    await tokenStore.upsert({
      accessToken: 'enc:old-access',
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      clientId: 'client',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() + 60_000),
      refreshToken: `enc:${refreshToken}`,
      userId: 'user-1',
    });
  };

  beforeEach(() => {
    handoffs.length = 0;
    tokenStore = createMemoryOpenAICodexTokenStore();
    fetchFn.mockReset();
    db.delete.mockClear();
    db.insert.mockClear();
    db.select.mockClear();
  });

  it('starts a device login and stores only the device handoff', async () => {
    fetchFn.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          device_auth_id: 'device-1',
          user_code: 'ABCD-1234',
          verification_url: 'https://auth.openai.com/codex/device',
        }),
    });

    const started = await service().startDeviceLogin('user-1');

    expect(started.userCode).toBe('ABCD-1234');
    expect(started.verificationUrl).toContain('/codex/device');
    expect(handoffs[0]).toMatchObject({
      client: 'openai-codex-device',
      payload: expect.objectContaining({
        deviceAuthId: 'device-1',
        userCode: 'ABCD-1234',
        userId: 'user-1',
      }),
    });
    expect(JSON.stringify(started)).not.toContain('refresh');
    expect(JSON.stringify(started)).not.toContain(accessToken);
  });

  it('exchanges a completed device poll and never returns tokens from status', async () => {
    handoffs.push({
      client: 'openai-codex-device',
      id: 'handoff-1',
      payload: {
        deviceAuthId: 'device-1',
        expiresAt: Date.now() + 60_000,
        userCode: 'ABCD-1234',
        userId: 'user-1',
      },
    });

    fetchFn
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            authorization_code: 'auth-code',
            code_verifier: 'verifier',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: accessToken,
            expires_in: 3600,
            refresh_token: 'refresh-1',
          }),
      });

    const polled = await service().pollDeviceLogin('user-1', 'handoff-1');

    expect(polled).toMatchObject({
      connected: true,
      email: 'plus@example.com',
      status: 'connected',
    });
    expect(JSON.stringify(polled)).not.toContain(accessToken);
    expect(JSON.stringify(polled)).not.toContain('refresh-1');
    expect(tokenStore.rows.get('user-1')).toMatchObject({
      accessToken: `enc:${accessToken}`,
      accountId: 'acct_1',
      refreshToken: 'enc:refresh-1',
      userId: 'user-1',
    });

    const status = await service().getStatus('user-1');
    expect(status).toEqual(
      expect.objectContaining({
        connected: true,
        email: 'plus@example.com',
      }),
    );
    expect(JSON.stringify(status)).not.toContain(accessToken);
  });

  it('returns pending while device authorization is not finished', async () => {
    handoffs.push({
      client: 'openai-codex-device',
      id: 'handoff-1',
      payload: {
        deviceAuthId: 'device-1',
        expiresAt: Date.now() + 60_000,
        userCode: 'ABCD-1234',
        userId: 'user-1',
      },
    });
    fetchFn.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'authorization_pending' }),
    });

    await expect(service().pollDeviceLogin('user-1', 'handoff-1')).resolves.toEqual({
      status: 'pending',
    });
  });

  it('refreshes a near-expiry session and rotates the refresh token', async () => {
    await seedExpiringSession();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: 'new-refresh',
        }),
    });

    const session = await service().resolveLiveSession('user-1');

    expect(session).toMatchObject({
      accessToken,
      accountId: 'acct_1',
    });
    expect(tokenStore.rows.get('user-1')).toMatchObject({
      refreshToken: 'enc:new-refresh',
    });
  });

  it('does not double-redeem across workers when process locks are disabled', async () => {
    await seedExpiringSession();
    const disableProcessLock = async <T>(_userId: string, fn: () => Promise<T>) => fn();
    let releaseFirst!: (value: unknown) => void;
    const firstRefresh = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    fetchFn.mockImplementation(async (_url, init) => {
      calls += 1;
      const body = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
      expect(new URLSearchParams(body).get('refresh_token')).toBe('old-refresh');
      if (calls === 1) await firstRefresh;
      return {
        ok: calls === 1,
        status: calls === 1 ? 200 : 400,
        text: async () =>
          calls === 1
            ? JSON.stringify({
                access_token: accessToken,
                expires_in: 3600,
                refresh_token: 'new-refresh',
              })
            : JSON.stringify({ error: 'refresh_token_reused' }),
      };
    });

    const first = service({ lockUser: disableProcessLock });
    const second = service({ lockUser: disableProcessLock });
    const pendingA = first.resolveLiveSession('user-1');
    const pendingB = second.resolveLiveSession('user-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    releaseFirst(undefined);

    const results = await Promise.allSettled([pendingA, pendingB]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(results.map((result) => (result as PromiseFulfilledResult<any>).value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct_1' }),
      ]),
    );
    expect(results.some((result) => result.status === 'fulfilled' && result.value === null)).toBe(
      false,
    );
    expect(tokenStore.rows.size).toBe(1);
    expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent refresh so one valid row remains', async () => {
    await seedExpiringSession();
    let releaseFirst!: (value: unknown) => void;
    const firstRefresh = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    fetchFn.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await firstRefresh;
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: accessToken,
            expires_in: 3600,
            refresh_token: 'new-refresh',
          }),
      };
    });

    const first = service();
    const second = service();
    const pendingA = first.resolveLiveSession('user-1');
    const pendingB = second.resolveLiveSession('user-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    releaseFirst(undefined);

    const [sessionA, sessionB] = await Promise.all([pendingA, pendingB]);
    expect(sessionA?.accessToken).toBe(accessToken);
    expect(sessionB?.accessToken).toBe(accessToken);
    expect(tokenStore.rows.size).toBe(1);
    expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a session when logout races an in-flight refresh', async () => {
    await seedExpiringSession();
    let finishRefresh!: (value: unknown) => void;
    fetchFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );

    const oauth = service();
    const pending = oauth.resolveLiveSession('user-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const logout = oauth.logout('user-1');
    finishRefresh({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: 'new-refresh',
        }),
    });

    await Promise.all([pending, logout]);
    expect(tokenStore.rows.size).toBe(0);
  });

  it('does not let a stale refresh overwrite a newer login', async () => {
    await seedExpiringSession();
    let finishRefresh!: (value: unknown) => void;
    fetchFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );

    const pending = service().resolveLiveSession('user-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await tokenStore.upsert({
      accessToken: `enc:${loginAccessToken}`,
      accountId: 'acct_2',
      chatgptPlanType: 'pro',
      clientId: 'client',
      email: 'pro@example.com',
      expiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'enc:login-refresh',
      userId: 'user-1',
    });
    finishRefresh({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: 'stale-refresh',
        }),
    });

    const session = await pending;
    expect(session).toMatchObject({
      accessToken: loginAccessToken,
      accountId: 'acct_2',
    });
    expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:login-refresh');
  });

  it('keeps a newer rotation when a stale refresh is rejected as reused', async () => {
    await seedExpiringSession();
    let finishRefresh!: (value: unknown) => void;
    fetchFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );

    const pending = service().resolveLiveSession('user-1');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await tokenStore.upsert({
      accessToken: `enc:${accessToken}`,
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      clientId: 'client',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'enc:new-refresh',
      userId: 'user-1',
    });
    finishRefresh({
      ok: false,
      text: async () => JSON.stringify({ error: 'refresh_token_reused' }),
    });

    await expect(pending).resolves.toMatchObject({
      accessToken,
      accountId: 'acct_1',
    });
    expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
  });

  it('disconnects only the matching credential version on invalid_grant', async () => {
    await seedExpiringSession();
    fetchFn.mockResolvedValueOnce({
      ok: false,
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    });

    await expect(service().resolveLiveSession('user-1')).resolves.toBeNull();
    expect(tokenStore.rows.size).toBe(0);
  });

  it.each([429, 500, 502, 503])(
    'preserves the session on transient HTTP %s and does not fall back',
    async (status) => {
      await seedExpiringSession();
      fetchFn.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => 'temporarily unavailable',
      });

      const session = await service().resolveLiveSession('user-1');
      expect(session).toMatchObject({ accessToken: 'old-access', accountId: 'acct_1' });
      expect(tokenStore.rows.size).toBe(1);
      expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:old-refresh');
    },
  );

  it('throws a retryable error when a transient refresh happens after expiry', async () => {
    await tokenStore.upsert({
      accessToken: 'enc:old-access',
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      clientId: 'client',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() - 1000),
      refreshToken: 'enc:old-refresh',
      userId: 'user-1',
    });
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    });

    await expect(service().resolveLiveSession('user-1')).rejects.toBeInstanceOf(
      OpenAICodexTransientRefreshError,
    );
    expect(tokenStore.rows.size).toBe(1);
  });

  it('attaches 5-hour and weekly remaining from /wham/usage without returning tokens', async () => {
    await tokenStore.upsert({
      accessToken: `enc:${accessToken}`,
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      clientId: 'client',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshToken: 'enc:refresh-1',
      userId: 'user-1',
    });
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          plan_type: 'plus',
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_at: 1_778_670_307,
              used_percent: 27,
            },
            secondary_window: {
              limit_window_seconds: 604_800,
              reset_at: 1_783_357_722,
              used_percent: 31,
            },
          },
        }),
    });

    const status = await service().getStatus('user-1');

    expect(status).toMatchObject({
      chatgptPlanType: 'plus',
      connected: true,
      email: 'plus@example.com',
      fiveHour: { remainingPercent: 73, usedPercent: 27 },
      weekly: { remainingPercent: 69, usedPercent: 31 },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          'ChatGPT-Account-Id': 'acct_1',
        }),
        method: 'GET',
      }),
    );
    expect(JSON.stringify(status)).not.toContain(accessToken);
    expect(JSON.stringify(fetchFn.mock.calls)).toContain(accessToken);
  });

  it('keeps the connection when usage lookup fails', async () => {
    await tokenStore.upsert({
      accessToken: `enc:${accessToken}`,
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      clientId: 'client',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshToken: 'enc:refresh-1',
      userId: 'user-1',
    });
    fetchFn.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const status = await service().getStatus('user-1');
    expect(status).toEqual(
      expect.objectContaining({
        connected: true,
        email: 'plus@example.com',
      }),
    );
    expect(status.fiveHour).toBeUndefined();
    expect(status.weekly).toBeUndefined();
  });

  describe('refresh lease lifetime', () => {
    const disableProcessLock = async <T>(_userId: string, fn: () => Promise<T>) => fn();

    afterEach(() => {
      vi.useRealTimers();
    });

    const startHeldRefresh = async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-19T09:00:00Z'));
      await seedExpiringSession();

      let finishFirst!: (value: unknown) => void;
      const firstResponse = new Promise((resolve) => {
        finishFirst = resolve;
      });
      let firstStarted!: () => void;
      const firstStartedPromise = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });

      fetchFn.mockImplementation(async () => {
        if (fetchFn.mock.calls.length === 1) {
          firstStarted();
          return firstResponse;
        }
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'refresh_token_reused' }),
        };
      });

      const first = service({ lockUser: disableProcessLock });
      const second = service({ lockUser: disableProcessLock });
      const pendingA = first.resolveLiveSession('user-1');
      await firstStartedPromise;

      return {
        finishRejection: () =>
          finishFirst({
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: 'refresh_token_reused' }),
          }),
        finishSuccess: () =>
          finishFirst({
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                access_token: accessToken,
                expires_in: 3600,
                refresh_token: 'new-refresh',
              }),
          }),
        pendingA,
        second,
      };
    };

    it('keeps exclusion after the lease timestamp expires during a delayed fetch', async () => {
      const { finishSuccess, pendingA, second } = await startHeldRefresh();
      vi.setSystemTime(Date.now() + 31_000);

      await expect(second.resolveLiveSession('user-1')).resolves.toMatchObject({
        accessToken: 'old-access',
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      finishSuccess();

      await expect(pendingA).resolves.toMatchObject({ accessToken });
      expect(tokenStore.rows.size).toBe(1);
      expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('keeps exclusion while the owner is still reading a delayed response body', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-19T09:00:00Z'));
      await seedExpiringSession();

      let resolveBody!: (value: string) => void;
      const body = new Promise<string>((resolve) => {
        resolveBody = resolve;
      });
      let bodyStarted!: () => void;
      const bodyStartedPromise = new Promise<void>((resolve) => {
        bodyStarted = resolve;
      });

      fetchFn.mockImplementation(async () => {
        if (fetchFn.mock.calls.length === 1) {
          return {
            ok: true,
            status: 200,
            text: async () => {
              bodyStarted();
              return body;
            },
          };
        }
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'refresh_token_reused' }),
        };
      });

      const first = service({ lockUser: disableProcessLock });
      const second = service({ lockUser: disableProcessLock });
      const pendingA = first.resolveLiveSession('user-1');
      await bodyStartedPromise;
      vi.setSystemTime(Date.now() + 31_000);

      await expect(second.resolveLiveSession('user-1')).resolves.toMatchObject({
        accessToken: 'old-access',
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);

      resolveBody(
        JSON.stringify({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: 'new-refresh',
        }),
      );

      await expect(pendingA).resolves.toMatchObject({ accessToken });
      expect(tokenStore.rows.size).toBe(1);
      expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('does not let a stale owner erase credentials after losing the lease', async () => {
      const { finishRejection, pendingA } = await startHeldRefresh();
      const held = tokenStore.rows.get('user-1');
      expect(held?.refreshLockId).toBeTruthy();
      await tokenStore.releaseRefreshLock('user-1', held!.refreshLockId!);
      await expect(
        tokenStore.tryAcquireRefreshLock('user-1', 'replacement-lock', 30_000),
      ).resolves.toBe(true);

      finishRejection();
      await expect(pendingA).resolves.toMatchObject({ accessToken: 'old-access' });
      expect(tokenStore.rows.size).toBe(1);
      expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:old-refresh');
      expect(tokenStore.rows.get('user-1')?.refreshLockId).toBe('replacement-lock');
    });

    it('lets a later worker redeem only after the previous owner releases', async () => {
      await seedExpiringSession();
      await expect(tokenStore.tryAcquireRefreshLock('user-1', 'abandoned-lock', 30_000)).resolves.toBe(
        true,
      );
      await tokenStore.releaseRefreshLock('user-1', 'abandoned-lock');
      fetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: accessToken,
            expires_in: 3600,
            refresh_token: 'new-refresh',
          }),
      });

      await expect(
        service({ lockUser: disableProcessLock }).resolveLiveSession('user-1'),
      ).resolves.toMatchObject({ accessToken });
      expect(tokenStore.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
    });
  });
});
