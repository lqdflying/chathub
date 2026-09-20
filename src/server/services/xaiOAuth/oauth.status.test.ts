// @vitest-environment node
import { XAI_OAUTH_BILLING_URL, XAI_OAUTH_CLIENT_ID } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { XaiOAuthTransientRefreshError } from './errors';
import { createMemoryXaiDeviceHandoffStore } from './handoffStore';
import { XaiOAuthService } from './oauth';
import { createMemoryXaiOAuthTokenStore } from './tokenStore';
import { remainingPercentFromUsed } from './usage';

describe('XaiOAuthService.getStatus usage windows', () => {
  const fetchFn = vi.fn();
  const crypto = {
    decrypt: vi.fn(async (value: string) => ({
      plaintext: value.replace(/^enc:/, ''),
      wasAuthentic: true,
    })),
    encrypt: vi.fn(async (value: string) => `enc:${value}`),
  };
  let handoffStore: ReturnType<typeof createMemoryXaiDeviceHandoffStore>;
  let tokenStore: ReturnType<typeof createMemoryXaiOAuthTokenStore>;

  const service = (overrides?: ConstructorParameters<typeof XaiOAuthService>[1]) =>
    new XaiOAuthService({} as any, {
      crypto,
      fetchFn: fetchFn as any,
      handoffStore,
      tokenStore,
      ...overrides,
    });

  const seedSession = async () => {
    await tokenStore.upsert({
      accessToken: 'enc:access-1',
      clientId: XAI_OAUTH_CLIENT_ID,
      email: 'lqdflying@gmail.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      refreshToken: 'enc:refresh-1',
      userId: 'user-1',
    });
  };

  beforeEach(() => {
    fetchFn.mockReset();
    handoffStore = createMemoryXaiDeviceHandoffStore();
    tokenStore = createMemoryXaiOAuthTokenStore();
  });

  it('attaches the weekly SuperGrok remaining bar from billing credits', async () => {
    await seedSession();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          config: {
            creditUsagePercent: 37,
            currentPeriod: {
              end: '2026-09-26T00:00:00Z',
              type: 'CREDIT_WEEKLY',
            },
          },
        }),
    });

    const status = await service().getStatus('user-1');

    expect(status).toMatchObject({
      connected: true,
      email: 'lqdflying@gmail.com',
      weekly: {
        label: 'Weekly',
        remainingPercent: remainingPercentFromUsed(37),
        usedPercent: 37,
      },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      XAI_OAUTH_BILLING_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-1',
          'x-grok-client-mode': 'cli',
          'x-xai-token-auth': 'xai-grok-cli',
        }),
        method: 'GET',
      }),
    );
    expect(JSON.stringify(status)).not.toContain('access-1');
  });

  it('attaches weekly remaining from the on-demand ratio when creditUsagePercent is omitted', async () => {
    await seedSession();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          config: {
            currentPeriod: {
              end: '2026-09-26T00:00:00Z',
              type: 'USAGE_PERIOD_TYPE_WEEKLY',
            },
            onDemandCap: { val: 80 },
            onDemandUsed: { val: 20 },
          },
        }),
    });

    await expect(service().getStatus('user-1')).resolves.toMatchObject({
      connected: true,
      weekly: {
        label: 'Weekly',
        remainingPercent: remainingPercentFromUsed(25),
        usedPercent: 25,
      },
    });
  });

  it('keeps the weekly window when billing reports a period but no percent', async () => {
    await seedSession();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          config: {
            currentPeriod: {
              end: '2026-09-26T00:00:00Z',
              type: 'USAGE_PERIOD_TYPE_WEEKLY',
            },
            monthlyLimit: { val: 0 },
            onDemandCap: { val: 0 },
          },
        }),
    });

    const status = await service().getStatus('user-1');
    expect(status.connected).toBe(true);
    expect(status.weekly).toEqual({
      label: 'Weekly',
      resetsAt: '2026-09-26T00:00:00.000Z',
    });
    expect(status.weekly?.remainingPercent).toBeUndefined();
  });

  it('still fetches usage after a transient refresh error while the access token is valid', async () => {
    await seedSession();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          config: {
            creditUsagePercent: 10,
            currentPeriod: { type: 'CREDIT_WEEKLY' },
          },
        }),
    });

    const status = await service({
      lockUser: async () => {
        throw new XaiOAuthTransientRefreshError('SuperGrok refresh is temporarily unavailable.', 0);
      },
    }).getStatus('user-1');

    expect(status).toMatchObject({
      connected: true,
      weekly: { remainingPercent: remainingPercentFromUsed(10), usedPercent: 10 },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the SuperGrok connection when usage lookup fails', async () => {
    await seedSession();
    fetchFn.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const status = await service().getStatus('user-1');
    expect(status).toEqual(
      expect.objectContaining({
        connected: true,
        email: 'lqdflying@gmail.com',
      }),
    );
    expect(status.fiveHour).toBeUndefined();
    expect(status.weekly).toBeUndefined();
  });
});
