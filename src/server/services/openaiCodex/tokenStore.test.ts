// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMemoryOpenAICodexTokenStore } from './tokenStore';

const row = (userId: string, refreshToken: string, accessToken = 'enc:access') => ({
  accessToken,
  accountId: 'acct_1',
  chatgptPlanType: 'plus',
  clientId: 'client',
  email: 'plus@example.com',
  expiresAt: new Date('2026-09-19T00:00:00Z'),
  refreshToken,
  userId,
});

describe('createMemoryOpenAICodexTokenStore', () => {
  it('rotates only the matching refresh-token version', async () => {
    const store = createMemoryOpenAICodexTokenStore();
    await store.upsert(row('user-1', 'enc:old-refresh'));

    await expect(
      store.updateIfRefreshMatches('user-1', 'enc:old-refresh', row('user-1', 'enc:new-refresh')),
    ).resolves.toBe(true);
    await expect(
      store.updateIfRefreshMatches('user-1', 'enc:old-refresh', row('user-1', 'enc:stale-refresh')),
    ).resolves.toBe(false);

    expect(store.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
    expect(store.rows.size).toBe(1);
  });

  it('deletes only the matching refresh-token version', async () => {
    const store = createMemoryOpenAICodexTokenStore();
    await store.upsert(row('user-1', 'enc:new-refresh'));

    await expect(store.deleteIfRefreshMatches('user-1', 'enc:old-refresh')).resolves.toBe(false);
    expect(store.rows.has('user-1')).toBe(true);

    await expect(store.deleteIfRefreshMatches('user-1', 'enc:new-refresh')).resolves.toBe(true);
    expect(store.rows.size).toBe(0);
  });

  it('rotates and deletes only while the caller still owns the lease', async () => {
    const store = createMemoryOpenAICodexTokenStore();
    await store.upsert(row('user-1', 'enc:old-refresh'));
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-a', 30_000)).resolves.toBe(true);

    await expect(
      store.updateIfRefreshMatches(
        'user-1',
        'enc:old-refresh',
        row('user-1', 'enc:stolen-refresh'),
        'lock-b',
      ),
    ).resolves.toBe(false);
    await expect(store.deleteIfRefreshMatches('user-1', 'enc:old-refresh', 'lock-b')).resolves.toBe(
      false,
    );
    expect(store.rows.get('user-1')?.refreshToken).toBe('enc:old-refresh');

    await expect(
      store.updateIfRefreshMatches(
        'user-1',
        'enc:old-refresh',
        row('user-1', 'enc:new-refresh'),
        'lock-a',
      ),
    ).resolves.toBe(true);
    expect(store.rows.get('user-1')?.refreshToken).toBe('enc:new-refresh');
    expect(store.rows.get('user-1')?.refreshLockId).toBeNull();
  });

  it('acquires a refresh lease only when none is held', async () => {
    const store = createMemoryOpenAICodexTokenStore();
    await store.upsert(row('user-1', 'enc:old-refresh'));

    await expect(store.tryAcquireRefreshLock('user-1', 'lock-a', 30_000)).resolves.toBe(true);
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-b', 30_000)).resolves.toBe(false);
    expect(store.rows.get('user-1')?.refreshLockId).toBe('lock-a');

    await store.releaseRefreshLock('user-1', 'lock-b');
    expect(store.rows.get('user-1')?.refreshLockId).toBe('lock-a');

    await store.releaseRefreshLock('user-1', 'lock-a');
    expect(store.rows.get('user-1')?.refreshLockId).toBeNull();
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-b', 30_000)).resolves.toBe(true);
  });

  it('does not let wall-clock expiry transfer a held refresh lease', async () => {
    const store = createMemoryOpenAICodexTokenStore();
    await store.upsert(row('user-1', 'enc:old-refresh'));
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-a', 0)).resolves.toBe(true);
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-b', 30_000)).resolves.toBe(false);
    expect(store.rows.get('user-1')?.refreshLockId).toBe('lock-a');

    await store.releaseRefreshLock('user-1', 'lock-a');
    await expect(store.tryAcquireRefreshLock('user-1', 'lock-b', 30_000)).resolves.toBe(true);
    expect(store.rows.get('user-1')?.refreshLockId).toBe('lock-b');
  });
});
