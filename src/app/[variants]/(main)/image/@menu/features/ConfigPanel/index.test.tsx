import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConfigPanel from './index';

const { aiInfraListeners, aiInfraState, imageListeners, imageState, userListeners, userState } =
  vi.hoisted(() => ({
    aiInfraListeners: new Set<() => void>(),
    aiInfraState: {
      refreshAiProviderRuntimeState: vi.fn(),
      runtimeStateInitializationFailure: undefined as
        | { reason: 'request-failed'; scope: string }
        | undefined,
    },
    imageListeners: new Set<() => void>(),
    imageState: {
      isImageModelAvailable: false,
      isInit: false,
      parametersSchema: {},
    },
    userListeners: new Set<() => void>(),
    userState: {
      authUserId: 'account-a' as string | undefined,
      isLoaded: true,
      isSignedIn: true as boolean | undefined,
      logout: vi.fn(),
      refreshUserState: vi.fn(),
      user: { id: 'account-a' } as { id: string } | undefined,
      userStateInitializationFailure: undefined as
        | { reason: 'owner-mismatch' | 'request-failed'; scope: string }
        | undefined,
    },
  }));

const updateStoreState = <State extends object>(
  state: State,
  listeners: Set<() => void>,
  update: Partial<State>,
) => {
  Object.assign(state, update);
  listeners.forEach((listener) => listener());
};

vi.mock('@/store/aiInfra', async () => {
  const React = await import('react');

  return {
    useAiInfraStore: <Selected,>(selector: (state: typeof aiInfraState) => Selected) =>
      React.useSyncExternalStore(
        (listener) => {
          aiInfraListeners.add(listener);
          return () => aiInfraListeners.delete(listener);
        },
        () => selector(aiInfraState),
        () => selector(aiInfraState),
      ),
  };
});

vi.mock('@/store/user', async () => {
  const React = await import('react');

  return {
    useUserStore: <Selected,>(selector: (state: typeof userState) => Selected) =>
      React.useSyncExternalStore(
        (listener) => {
          userListeners.add(listener);
          return () => userListeners.delete(listener);
        },
        () => selector(userState),
        () => selector(userState),
      ),
  };
});

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: (state: typeof userState) => {
      if (!state.isLoaded || state.isSignedIn === undefined) return undefined;
      if (!state.isSignedIn) return 'guest';

      const authenticatedUserId = state.authUserId || state.user?.id;
      return authenticatedUserId ? `user:${authenticatedUserId}` : undefined;
    },
    isLoaded: (state: typeof userState) => state.isLoaded,
    isLogin: (state: typeof userState) => state.isSignedIn,
  },
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({
    colorBgContainer: '#fff',
    colorBorder: '#ddd',
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({
    action,
    description,
    message,
  }: {
    action?: React.ReactNode;
    description?: React.ReactNode;
    message: React.ReactNode;
  }) => (
    <div role="alert">
      <div>{message}</div>
      <div>{description}</div>
      {action}
    </div>
  ),
  Button: ({
    children,
    icon: _icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/image/slices/generationConfig/hooks', () => ({
  useDimensionControl: () => ({ showDimensionControl: false }),
}));

vi.mock('@/store/image/store', async () => {
  const React = await import('react');

  return {
    useImageStore: <Selected,>(selector: (state: typeof imageState) => Selected) =>
      React.useSyncExternalStore(
        (listener) => {
          imageListeners.add(listener);
          return () => imageListeners.delete(listener);
        },
        () => selector(imageState),
        () => selector(imageState),
      ),
  };
});

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const resetStoreStates = () => {
  updateStoreState(aiInfraState, aiInfraListeners, {
    refreshAiProviderRuntimeState: vi.fn(),
    runtimeStateInitializationFailure: undefined,
  });
  updateStoreState(imageState, imageListeners, {
    isImageModelAvailable: false,
    isInit: false,
    parametersSchema: {},
  });
  updateStoreState(userState, userListeners, {
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    logout: vi.fn(),
    refreshUserState: vi.fn(),
    user: { id: 'account-a' },
    userStateInitializationFailure: undefined,
  });
};

vi.mock('./components/ImageConfigSkeleton', () => ({
  default: () => <div>image-config-skeleton</div>,
}));
vi.mock('./components/ModelSelect', () => ({
  default: () => <div>model-select</div>,
}));

vi.mock('./components/CfgSliderInput', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/DimensionControlGroup', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageNum', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageUrl', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/ImageUrlsUpload', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/QualitySelect', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/SeedNumberInput', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/SizeSelect', () => ({
  default: () => <div>parameter-control</div>,
}));
vi.mock('./components/StepsSliderInput', () => ({
  default: () => <div>parameter-control</div>,
}));

describe('ConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreStates();
  });

  it('shows the loading skeleton before configuration hydration settles', () => {
    render(<ConfigPanel />);

    expect(screen.getByText('image-config-skeleton')).not.toBeNull();
    expect(screen.queryByText('model-select')).toBeNull();
  });

  it('shows model guidance without stale controls when no model is available', () => {
    imageState.isInit = true;

    render(<ConfigPanel />);

    expect(screen.getByText('model-select')).not.toBeNull();
    expect(screen.queryByText('image-config-skeleton')).toBeNull();
    expect(screen.queryByText('parameter-control')).toBeNull();
  });

  it('retries only failed current-scope resources and settles without remounting', async () => {
    const retryFinished = createDeferred();
    userState.refreshUserState = vi.fn(async () => {
      updateStoreState(userState, userListeners, {
        userStateInitializationFailure: undefined,
      });
      await retryFinished.promise;
    });
    updateStoreState(userState, userListeners, {
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<ConfigPanel />);

    expect(screen.getByRole('alert').textContent).toContain('config.bootstrapFailure.title');
    expect(screen.queryByText('image-config-skeleton')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'config.bootstrapFailure.retry' }));

    expect(userState.refreshUserState).toHaveBeenCalledTimes(1);
    expect(aiInfraState.refreshAiProviderRuntimeState).not.toHaveBeenCalled();
    expect(screen.getByText('image-config-skeleton')).not.toBeNull();

    await act(async () => {
      updateStoreState(imageState, imageListeners, { isInit: true });
      retryFinished.resolve();
      await retryFinished.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('model-select')).not.toBeNull();
    });
  });

  it('returns to failure guidance when a provider retry fails', async () => {
    aiInfraState.refreshAiProviderRuntimeState = vi.fn(async () => {
      updateStoreState(aiInfraState, aiInfraListeners, {
        runtimeStateInitializationFailure: undefined,
      });
      await Promise.resolve();
      updateStoreState(aiInfraState, aiInfraListeners, {
        runtimeStateInitializationFailure: {
          reason: 'request-failed',
          scope: 'user:account-a',
        },
      });
    });
    updateStoreState(aiInfraState, aiInfraListeners, {
      runtimeStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'config.bootstrapFailure.retry' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });
    expect(aiInfraState.refreshAiProviderRuntimeState).toHaveBeenCalledTimes(1);
    expect(userState.refreshUserState).not.toHaveBeenCalled();
  });

  it('requires reauthentication without retrying an owner mismatch', async () => {
    updateStoreState(imageState, imageListeners, { isInit: true });
    updateStoreState(userState, userListeners, {
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    render(<ConfigPanel />);

    expect(screen.getByRole('alert').textContent).toContain(
      'config.bootstrapFailure.ownerMismatchDescription',
    );
    expect(
      screen.queryByRole('button', { name: 'config.bootstrapFailure.retry' }),
    ).toBeNull();
    expect(screen.queryByText('model-select')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'config.bootstrapFailure.signInAgain' }));

    expect(userState.logout).toHaveBeenCalledTimes(1);
    expect(userState.refreshUserState).not.toHaveBeenCalled();
    expect(aiInfraState.refreshAiProviderRuntimeState).not.toHaveBeenCalled();
  });

  it('stops showing an earlier account retry after the active scope changes', async () => {
    const accountARetryFinished = createDeferred();
    userState.refreshUserState = vi.fn(async () => {
      updateStoreState(userState, userListeners, {
        userStateInitializationFailure: undefined,
      });
      await accountARetryFinished.promise;
    });
    updateStoreState(userState, userListeners, {
      userStateInitializationFailure: {
        reason: 'request-failed',
        scope: 'user:account-a',
      },
    });

    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'config.bootstrapFailure.retry' }));
    expect(screen.getByText('image-config-skeleton')).not.toBeNull();

    act(() => {
      updateStoreState(userState, userListeners, {
        authUserId: 'account-b',
        user: { id: 'account-b' },
      });
      updateStoreState(imageState, imageListeners, { isInit: true });
    });

    expect(screen.getByText('model-select')).not.toBeNull();
    expect(screen.queryByText('image-config-skeleton')).toBeNull();

    await act(async () => {
      accountARetryFinished.resolve();
      await accountARetryFinished.promise;
    });
  });

  it('shows bounded guidance when an authenticated account scope cannot resolve', () => {
    updateStoreState(imageState, imageListeners, { isInit: true });
    updateStoreState(userState, userListeners, {
      authUserId: undefined,
      user: undefined,
    });

    render(<ConfigPanel />);

    expect(screen.getByRole('alert').textContent).toContain(
      'config.bootstrapFailure.accountDescription',
    );
    expect(
      screen.queryByRole('button', { name: 'config.bootstrapFailure.retry' }),
    ).toBeNull();
    expect(screen.queryByText('image-config-skeleton')).toBeNull();
  });
});
