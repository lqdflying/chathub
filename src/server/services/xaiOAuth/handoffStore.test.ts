// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { oauthHandoffs } from '@/database/schemas/oidc';

import {
  canClaimXaiDevicePoll,
  createDrizzleXaiDeviceHandoffStore,
  createMemoryXaiDeviceHandoffStore,
} from './handoffStore';

const collectStrings = (node: unknown) => {
  const texts: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string') {
      texts.push(value);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const nested of Object.values(value)) walk(nested);
  };
  walk(node);
  return texts;
};

const payload = {
  deviceCode: 'device-1',
  expiresAt: 2_000,
  intervalMs: 5_000,
  nextPollAt: 1_000,
  tokenEndpoint: 'https://auth.x.ai/oauth/token',
  userCode: 'ABCD',
  userId: 'user-1',
};

describe('xAI device handoff ownership', () => {
  it('rejects a claim while the interval or live owner is still active', () => {
    expect(canClaimXaiDevicePoll({ ...payload, nextPollAt: 1_001 }, 1_000)).toBe(false);
    expect(
      canClaimXaiDevicePoll({ ...payload, pollOwner: 'owner-a', pollUntil: 1_001 }, 1_000),
    ).toBe(false);
    expect(
      canClaimXaiDevicePoll({ ...payload, pollOwner: 'owner-a', pollUntil: 1_000 }, 1_000),
    ).toBe(true);
  });

  it('lets only one of two due claims win on a shared memory store', async () => {
    const store = createMemoryXaiDeviceHandoffStore();
    store.seed({ client: 'xai-oauth', id: 'handoff-1', payload });

    const [first, second] = await Promise.all([
      store.claimPoll('handoff-1', 1_000, 15_000),
      store.claimPoll('handoff-1', 1_000, 15_000),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.pollOwner).toBeTruthy();
    expect(winners[0]?.pollUntil).toBe(16_000);
    expect(store.getRow('handoff-1')?.payload.pollOwner).toBe(winners[0]?.pollOwner);
  });

  it('conditions drizzle claim and owner updates on nextPollAt and pollOwner', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'handoff-1' }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const select = vi.fn(() => ({
      from: () => ({
        where: async () => [
          { client: 'xai-oauth', id: 'handoff-1', payload },
        ],
      }),
    }));
    const store = createDrizzleXaiDeviceHandoffStore({
      select,
      update,
    } as any);

    await store.claimPoll('handoff-1', 1_000, 15_000);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          nextPollAt: 6_000,
          pollUntil: 16_000,
        }),
      }),
    );
    const claimTexts = collectStrings(where.mock.calls[0]?.[0]).join('\n');
    expect(claimTexts).toContain('nextPollAt');
    expect(claimTexts).toContain('pollOwner');
    expect(claimTexts).toContain('pollUntil');

    await store.saveIfOwner('handoff-1', 'owner-a', payload);
    const ownerTexts = collectStrings(where.mock.calls[1]?.[0]).join('\n');
    expect(ownerTexts).toContain('pollOwner');
    expect(ownerTexts).toContain(oauthHandoffs.id.name);
  });
});
