import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import {
  createAccountCacheKey,
  getAccountScopeFromKey,
  isAccountCacheKey,
  isAccountCacheKeyForScopeAndGeneration,
} from './accountCache';
import { mutateAccountSWRByPredicate, useClientDataSWR } from './index';

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
    expect(isAccountCacheKeyForScopeAndGeneration(key, 'local', 3)).toBe(true);
    expect(isAccountCacheKeyForScopeAndGeneration(key, 'local', 2)).toBe(false);
    expect(isAccountCacheKeyForScopeAndGeneration(key, 'user:account-a', 3)).toBe(false);
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

  it('revalidates predicate matches only in the current account epoch', async () => {
    const matchingFetcher = vi.fn().mockResolvedValue('matching');
    const nonMatchingFetcher = vi.fn().mockResolvedValue('non-matching');
    useUserStore.setState({
      ownershipInvalidationGeneration: 2,
    });

    const matchingHook = renderHook(() =>
      useClientDataSWR(['RAG_LIST', 'local', 'current'], matchingFetcher),
    );
    const nonMatchingHook = renderHook(() =>
      useClientDataSWR(['OTHER_LIST', 'local', 'current'], nonMatchingFetcher),
    );
    await waitFor(() => expect(matchingFetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nonMatchingFetcher).toHaveBeenCalledTimes(1));

    await mutateAccountSWRByPredicate(
      'local',
      (key) => key[0] === 'RAG_LIST',
    );

    await waitFor(() => expect(matchingFetcher).toHaveBeenCalledTimes(2));
    expect(nonMatchingFetcher).toHaveBeenCalledTimes(1);

    matchingHook.unmount();
    nonMatchingHook.unmount();
  });

  it('does not run predicate refreshes for stale scopes or owner mismatches', async () => {
    const fetcher = vi.fn().mockResolvedValue('local');
    useUserStore.setState({
      ownershipInvalidationGeneration: 3,
    });

    const accountHook = renderHook(() =>
      useClientDataSWR(['RAG_LIST', 'local'], fetcher),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await mutateAccountSWRByPredicate('user:stale-account', () => true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    useUserStore.setState({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'local',
      },
    });
    await mutateAccountSWRByPredicate('local', () => true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    accountHook.unmount();
  });
});
