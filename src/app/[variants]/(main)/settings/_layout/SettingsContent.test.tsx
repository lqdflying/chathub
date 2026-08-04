import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { type ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

vi.stubGlobal('React', React);

const { dynamicLoaderState, userStoreListeners, userStoreState } = vi.hoisted(() => ({
  dynamicLoaderState: { nextIndex: 0 },
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

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const loaderIndex = dynamicLoaderState.nextIndex;
    dynamicLoaderState.nextIndex += 1;

    const DynamicComponent = ({ mobile }: { mobile?: boolean }) => {
      void loader();
      return (
        <div
          data-mobile={mobile ? 'true' : 'false'}
          data-testid={`settings-component-${loaderIndex}`}
        />
      );
    };

    return DynamicComponent;
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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

describe('SettingsContent', () => {
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

  it('renders the dedicated page for the Chat Instruction tab', () => {
    render(<SettingsContent activeTab={SettingsTabs.ChatInstruction} mobile />);

    expect(screen.getByTestId('settings-component-1')).not.toBeNull();
    expect(screen.queryByTestId('settings-component-0')).toBeNull();
  });

  it('renders the Skills page with its mobile layout', () => {
    render(<SettingsContent activeTab={SettingsTabs.Skills} mobile />);

    expect(screen.getByTestId('settings-component-11').dataset.mobile).toBe('true');
  });

  it('retries a current-scope request failure and restores the tab loading UI', async () => {
    let finishRetry!: () => void;
    const retryRequest = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    userStoreState.refreshUserState = vi.fn(async () => {
      updateUserStore({ userStateInitializationFailure: undefined });
      await retryRequest;
    });
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<SettingsContent activeTab={SettingsTabs.SystemAgent} mobile />);

    expect(screen.getByRole('alert').textContent).toContain('bootstrapFailure.description');
    expect(screen.queryByTestId('settings-component-9')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'bootstrapFailure.retry' }));

    expect(userStoreState.refreshUserState).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('settings-component-9')).toBeNull();

    await act(async () => {
      finishRetry();
      await retryRequest;
    });

    expect(screen.getByTestId('settings-component-9')).not.toBeNull();
  });

  it('restores failure guidance when the retry request rejects', async () => {
    userStoreState.refreshUserState = vi.fn(async () => {
      updateUserStore({ userStateInitializationFailure: undefined });
      await Promise.resolve();
      updateUserStore({
        userStateInitializationFailure: {
          reason: 'request-failed',
          scope: 'user:account-a',
        },
      });
      throw new Error('retry failed');
    });
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<SettingsContent activeTab={SettingsTabs.SystemAgent} mobile />);

    fireEvent.click(screen.getByRole('button', { name: 'bootstrapFailure.retry' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('bootstrapFailure.description');
    });
    expect(userStoreState.refreshUserState).toHaveBeenCalledTimes(1);
  });

  it('requires sign-in again for an owner mismatch without retrying', () => {
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    render(<SettingsContent activeTab={SettingsTabs.SystemAgent} mobile />);

    expect(screen.getByRole('alert').textContent).toContain(
      'bootstrapFailure.ownerMismatchDescription',
    );
    expect(screen.queryByRole('button', { name: 'bootstrapFailure.retry' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'bootstrapFailure.signInAgain' }));

    expect(userStoreState.logout).toHaveBeenCalledTimes(1);
    expect(userStoreState.refreshUserState).not.toHaveBeenCalled();
  });

  it('requires sign-in again when the authenticated identity remains unresolved', () => {
    updateUserStore({
      authUserId: undefined,
      isLoaded: true,
      isSignedIn: true,
      userStateInitializationFailure: undefined,
    });

    render(<SettingsContent activeTab={SettingsTabs.Common} mobile />);

    expect(screen.getByRole('alert').textContent).toContain('bootstrapFailure.accountDescription');
    expect(screen.queryByRole('button', { name: 'bootstrapFailure.retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'bootstrapFailure.signInAgain' }));

    expect(userStoreState.logout).toHaveBeenCalledTimes(1);
  });

  it.each([
    [SettingsTabs.Provider, 'settings-component-3'],
    [SettingsTabs.RagProvider, 'settings-component-4'],
    [SettingsTabs.Storage, 'settings-component-8'],
    [SettingsTabs.Mcp, 'settings-component-10'],
  ])('guards the %s tab during a user-state failure', (tab, componentTestId) => {
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<SettingsContent activeTab={tab} mobile />);

    expect(screen.getByRole('alert').textContent).toContain('bootstrapFailure.description');
    expect(screen.queryByTestId(componentTestId)).toBeNull();
  });

  it('keeps account-independent tabs usable during a user-state failure', () => {
    updateUserStore({
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<SettingsContent activeTab={SettingsTabs.About} mobile />);

    expect(screen.getByTestId('settings-component-6')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps account controls hidden while authenticated user state is pending', () => {
    updateUserStore({
      isUserStateInit: false,
      userStateInitializationFailure: undefined,
      userStateScope: undefined,
    });

    render(<SettingsContent activeTab={SettingsTabs.Provider} mobile />);

    expect(screen.queryByTestId('settings-component-3')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [SettingsTabs.Provider, 'settings-component-3'],
    [SettingsTabs.Storage, 'settings-component-8'],
  ])('keeps the %s tab hidden until authentication loading resolves', (tab, componentTestId) => {
    updateUserStore({
      authUserId: undefined,
      isLoaded: false,
      isSignedIn: undefined,
      isUserStateInit: false,
      userStateInitializationFailure: undefined,
      userStateScope: undefined,
    });

    render(<SettingsContent activeTab={tab} mobile />);

    expect(screen.queryByTestId(componentTestId)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps account-independent tabs available while authentication is loading', () => {
    updateUserStore({
      authUserId: undefined,
      isLoaded: false,
      isSignedIn: undefined,
      isUserStateInit: false,
      userStateInitializationFailure: undefined,
      userStateScope: undefined,
    });

    render(<SettingsContent activeTab={SettingsTabs.About} mobile />);

    expect(screen.getByTestId('settings-component-6')).not.toBeNull();
  });
});
