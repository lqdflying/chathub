import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureAccountMutationSnapshot,
  captureSensitiveAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const setActiveAccount = (accountId: string, generation = 0): void => {
  useUserStore.setState({
    ...initialState,
    authUserId: accountId,
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    ownershipInvalidationGeneration: generation,
    user: { id: accountId },
    userStateInitializationFailure: undefined,
    userStateOwnerId: accountId,
    userStateScope: `user:${accountId}`,
  });
};

describe('account mutation ownership boundary', () => {
  beforeEach(() => {
    setActiveAccount('account-a');
  });

  it('captures the current account scope and ownership generation', () => {
    expect(captureAccountMutationSnapshot(useUserStore.getState())).toEqual({
      ownershipInvalidationGeneration: 0,
      scope: 'user:account-a',
    });
  });

  it('does not capture unresolved ownership', () => {
    useUserStore.setState({
      ...initialState,
      isLoaded: false,
      isSignedIn: undefined,
    });

    expect(captureAccountMutationSnapshot(useUserStore.getState())).toBeUndefined();
  });

  it('does not capture guest ownership for sensitive account operations', () => {
    useUserStore.setState({
      ...initialState,
      isLoaded: true,
      isSignedIn: false,
    });

    expect(captureAccountMutationSnapshot(useUserStore.getState())).toMatchObject({
      scope: 'guest',
    });
    expect(captureSensitiveAccountMutationSnapshot(useUserStore.getState())).toBeUndefined();
  });

  it('does not capture authenticated ownership before user state verifies the scope', () => {
    useUserStore.setState({
      isUserStateInit: false,
      userStateOwnerId: undefined,
      userStateScope: undefined,
    });

    expect(captureAccountMutationSnapshot(useUserStore.getState())).toBeUndefined();
  });

  it('does not capture authenticated ownership verified for another scope', () => {
    useUserStore.setState({
      isUserStateInit: true,
      userStateOwnerId: 'account-b',
      userStateScope: 'user:account-b',
    });

    expect(captureAccountMutationSnapshot(useUserStore.getState())).toBeUndefined();
  });

  it('does not capture an active same-scope owner mismatch', () => {
    useUserStore.setState({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    expect(captureAccountMutationSnapshot(useUserStore.getState())).toBeUndefined();
  });

  it('invalidates a snapshot after the account scope changes', () => {
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState())!;

    setActiveAccount('account-b');

    expect(isAccountMutationCurrent(useUserStore.getState(), snapshot)).toBe(false);
  });

  it('invalidates a snapshot after the ownership generation changes', () => {
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState())!;

    useUserStore.setState({ ownershipInvalidationGeneration: 1 });

    expect(isAccountMutationCurrent(useUserStore.getState(), snapshot)).toBe(false);
  });

  it('invalidates a snapshot when a same-scope owner mismatch becomes active', () => {
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState())!;

    useUserStore.setState({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    expect(isAccountMutationCurrent(useUserStore.getState(), snapshot)).toBe(false);
  });

  it('invalidates a snapshot when authenticated ownership verification is cleared', () => {
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState())!;

    useUserStore.setState({
      isUserStateInit: false,
      userStateOwnerId: undefined,
      userStateScope: undefined,
    });

    expect(isAccountMutationCurrent(useUserStore.getState(), snapshot)).toBe(false);
  });

  it('rejects an A-to-B-to-A transition even when the scope returns to its original value', () => {
    const snapshot = captureAccountMutationSnapshot(useUserStore.getState())!;

    setActiveAccount('account-b', 1);
    setActiveAccount('account-a', 2);

    expect(isAccountMutationCurrent(useUserStore.getState(), snapshot)).toBe(false);
  });
});
