import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import {
  createAccountCacheKey,
  getAccountScopeFromKey,
  isAccountCacheKey,
} from './accountCache';
import { useClientDataSWR } from './index';

describe('account SWR cache ownership', () => {
  beforeEach(() => {
    useUserStore.setState({
      ownershipInvalidationGeneration: 0,
      userStateInitializationFailure: undefined,
    });
  });

  it('tags account keys without changing existing key positions', () => {
    const key = createAccountCacheKey(['sessions', 'local', 'filter'], 3);

    expect(key).toEqual(['sessions', 'local', 'filter', ['account-cache-epoch', 3]]);
    expect(getAccountScopeFromKey(key)).toBe('local');
    expect(getAccountScopeFromKey(['sessions', 'user:account-a'])).toBe('user:account-a');
    expect(getAccountScopeFromKey(['locale', 'en-US'])).toBeUndefined();
    expect(isAccountCacheKey(key)).toBe(true);
    expect(isAccountCacheKey(['sessions', 'local', 'filter'])).toBe(false);
  });

  it('includes the ownership generation in account fetch keys', async () => {
    const fetcher = vi.fn().mockResolvedValue(['session-a']);

    renderHook(() => useClientDataSWR(['sessions', 'local'], fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith([
      'sessions',
      'local',
      ['account-cache-epoch', 0],
    ]);
  });

  it('disables account fetching while an owner mismatch is active', async () => {
    useUserStore.setState({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'local',
      },
    });
    const fetcher = vi.fn().mockResolvedValue(['session-a']);

    const { result } = renderHook(() =>
      useClientDataSWR(['sessions', 'local'], fetcher),
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('disables stale account keys after the canonical scope changes', async () => {
    const fetcher = vi.fn().mockResolvedValue(['session-a']);

    const { result } = renderHook(() =>
      useClientDataSWR(['sessions', 'user:account-a'], fetcher),
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('keeps ordinary unscoped array keys available', async () => {
    const fetcher = vi.fn().mockResolvedValue('English');

    renderHook(() => useClientDataSWR(['locale', 'en-US'], fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(['locale', 'en-US']);
  });

  it('suppresses a pending account response after ownership invalidation', async () => {
    let resolveRequest: ((value: string[]) => void) | undefined;
    const request = new Promise<string[]>((resolve) => {
      resolveRequest = resolve;
    });
    const onSuccess = vi.fn();

    renderHook(() =>
      useClientDataSWR(['sessions', 'local'], () => request, { onSuccess }),
    );

    useUserStore.setState({
      ownershipInvalidationGeneration: 1,
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'local',
      },
    });
    resolveRequest?.(['session-from-invalid-owner']);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });
});
