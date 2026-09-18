// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiCodexOAuthTokens } from '@/database/schemas/openaiCodexOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';

import { OpenAICodexOAuthService } from './oauth';

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

describe('OpenAICodexOAuthService', () => {
  const handoffs: any[] = [];
  const tokens: any[] = [];
  const fetchFn = vi.fn();
  const crypto = {
    decrypt: vi.fn(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    })),
    encrypt: vi.fn(async (value: string) => `enc:${value}`),
  };

  const db = {
    delete: vi.fn((table: unknown) => ({
      where: async () => {
        if (table === oauthHandoffs) handoffs.length = 0;
        if (table === openaiCodexOAuthTokens) tokens.length = 0;
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: async (row: any) => {
        if (table === oauthHandoffs) {
          handoffs.push(row);
          return;
        }
        tokens.push(row);
      },
    })),
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: async () => (table === oauthHandoffs ? [...handoffs] : [...tokens]),
      }),
    })),
  };

  const service = () =>
    new OpenAICodexOAuthService(db as any, { crypto, fetchFn: fetchFn as any });

  beforeEach(() => {
    handoffs.length = 0;
    tokens.length = 0;
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
    expect(tokens[0]).toMatchObject({
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
    tokens.push({
      accessToken: 'enc:old-access',
      accountId: 'acct_1',
      chatgptPlanType: 'plus',
      email: 'plus@example.com',
      expiresAt: new Date(Date.now() + 60_000),
      refreshToken: 'enc:old-refresh',
      userId: 'user-1',
    });
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
    expect(tokens.at(-1)).toMatchObject({
      refreshToken: 'enc:new-refresh',
    });
  });

  it('disconnects when refresh fails with invalid_grant', async () => {
    tokens.push({
      accessToken: 'enc:old-access',
      accountId: 'acct_1',
      expiresAt: new Date(Date.now() + 60_000),
      refreshToken: 'enc:old-refresh',
      userId: 'user-1',
    });
    fetchFn.mockResolvedValueOnce({
      ok: false,
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    });

    await expect(service().resolveLiveSession('user-1')).resolves.toBeNull();
    expect(db.delete).toHaveBeenCalled();
  });
});
