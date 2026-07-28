import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AssistantListBootstrapGuard from './AssistantListBootstrapGuard';

vi.stubGlobal('React', React);

const { userStoreListeners, userStoreState } = vi.hoisted(() => ({
  userStoreListeners: new Set<() => void>(),
  userStoreState: {
    authUserId: 'account-a' as string | undefined,
    isLoaded: true,
    isSignedIn: true as boolean | undefined,
    isUserStateInit: true,
    logout: vi.fn(),
    refreshUserState: vi.fn(),
    userStateInitializationFailure: undefined as
      { reason: 'owner-mismatch' | 'request-failed'; scope: string } | undefined,
    userStateScope: 'user:account-a' as string | undefined,
  },
}));

const updateUserStore = (update: Partial<typeof userStoreState>) => {
  Object.assign(userStoreState, update);
  userStoreListeners.forEach((listener) => listener());
};

vi.mock('@lobehub/ui', () => ({
  Alert: ({
    action,
    description,
    message,
  }: {
    action?: React.ReactNode;
    description?: React.ReactNode;
    message?: React.ReactNode;
  }) => (
    <div role="alert">
      <div>{message}</div>
      <div>{description}</div>
      {action}
    </div>
  ),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/store/user', async () => {
  const React = await import('react');

  return {
    useUserStore: <Selected,>(selector: (state: typeof userStoreState) => Selected) =>
      React.useSyncExternalStore(
        (listener) => {
          userStoreListeners.add(listener);
          return () => userStoreListeners.delete(listener);
        },
        () => selector(userStoreState),
        () => selector(userStoreState),
      ),
  };
});

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    assistantCreationStatus: (state: typeof userStoreState) => {
      const currentUserScope =
        state.isLoaded && state.isSignedIn && state.authUserId
          ? `user:${state.authUserId}`
          : state.isLoaded && state.isSignedIn === false
            ? 'guest'
            : undefined;
      const currentScopeFailure =
        currentUserScope && state.userStateInitializationFailure?.scope === currentUserScope
          ? state.userStateInitializationFailure
          : undefined;

      if (currentScopeFailure) return currentScopeFailure.reason;
      if (!currentUserScope) {
        return state.isLoaded && state.isSignedIn ? 'unresolved-authenticated-scope' : 'pending';
      }
      if (
        currentUserScope.startsWith('user:') &&
        (!state.isUserStateInit || state.userStateScope !== currentUserScope)
      ) {
        return 'pending';
      }

      return 'ready';
    },
    currentUserScope: (state: typeof userStoreState) =>
      state.isLoaded && state.isSignedIn && state.authUserId
        ? `user:${state.authUserId}`
        : state.isLoaded && state.isSignedIn === false
          ? 'guest'
          : undefined,
    isLoaded: (state: typeof userStoreState) => state.isLoaded,
    isLogin: (state: typeof userStoreState) => state.isSignedIn,
  },
}));

vi.mock('../SkeletonList', () => ({
  default: () => <div data-testid="session-list-skeleton" />,
}));

describe('AssistantListBootstrapGuard', () => {
  beforeEach(() => {
    updateUserStore({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      isUserStateInit: true,
      logout: vi.fn(),
      refreshUserState: vi.fn(),
      userStateInitializationFailure: undefined,
      userStateScope: 'user:account-a',
    });
  });

  it('renders assistant controls for a verified account', () => {
    render(
      <AssistantListBootstrapGuard>
        <div data-testid="assistant-controls" />
      </AssistantListBootstrapGuard>,
    );

    expect(screen.getByTestId('assistant-controls')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows retry guidance and keeps controls hidden during retry', async () => {
    let finishRetry!: () => void;
    const retryRequest = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    userStoreState.refreshUserState = vi.fn(async () => {
      updateUserStore({
        isUserStateInit: false,
        userStateInitializationFailure: undefined,
        userStateScope: undefined,
      });
      await retryRequest;
      updateUserStore({
        isUserStateInit: true,
        userStateScope: 'user:account-a',
      });
    });
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(
      <AssistantListBootstrapGuard>
        <div data-testid="assistant-controls" />
      </AssistantListBootstrapGuard>,
    );

    expect(screen.getByRole('alert').textContent).toContain('sessionBootstrapFailure.description');
    fireEvent.click(screen.getByRole('button', { name: 'sessionBootstrapFailure.retry' }));

    expect(userStoreState.refreshUserState).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('session-list-skeleton')).not.toBeNull();
    expect(screen.queryByTestId('assistant-controls')).toBeNull();

    await act(async () => {
      finishRetry();
      await retryRequest;
    });

    expect(screen.getByTestId('assistant-controls')).not.toBeNull();
  });

  it('requires sign-in again for an owner mismatch', () => {
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    render(
      <AssistantListBootstrapGuard>
        <div data-testid="assistant-controls" />
      </AssistantListBootstrapGuard>,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'sessionBootstrapFailure.ownerMismatchDescription',
    );
    fireEvent.click(screen.getByRole('button', { name: 'sessionBootstrapFailure.signInAgain' }));

    expect(userStoreState.logout).toHaveBeenCalledTimes(1);
    expect(userStoreState.refreshUserState).not.toHaveBeenCalled();
  });

  it('shows loading while authenticated ownership is pending', () => {
    updateUserStore({
      isUserStateInit: false,
      userStateScope: undefined,
    });

    render(
      <AssistantListBootstrapGuard>
        <div data-testid="assistant-controls" />
      </AssistantListBootstrapGuard>,
    );

    expect(screen.getByTestId('session-list-skeleton')).not.toBeNull();
    expect(screen.queryByTestId('assistant-controls')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
