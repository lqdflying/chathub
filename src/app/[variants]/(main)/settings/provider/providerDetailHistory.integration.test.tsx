/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import React, { useMemo, useSyncExternalStore } from 'react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

import Header from '@/app/[variants]/(main)/settings/_layout/Mobile/Header';
import Page from '@/app/[variants]/(main)/settings/provider/(list)';
import { SettingsTabs } from '@/store/global/initialState';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: Object.assign(
    ({ center, onBackClick }: { center?: React.ReactNode; onBackClick?: () => void }) => (
      <header>
        <button onClick={onBackClick} type="button">
          back
        </button>
        {center}
      </header>
    ),
    {
      Title: ({ title }: { title?: React.ReactNode }) => <span>{title}</span>,
    },
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/const/auth', () => ({ enableAuth: true }));
vi.mock('@/const/version', () => ({ isCustomBranding: true }));
vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId?: string }) => unknown) =>
    selector({ activeId: undefined }),
}));
vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => false,
}));
vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: (url: string) => {
      window.history.pushState(null, '', url);
    },
  }),
}));
vi.mock('@/app/[variants]/(main)/settings/provider/ProviderMenu', () => ({
  default: ({ onProviderSelect }: { onProviderSelect: (id: string) => void }) => (
    <div data-testid="list">
      <button onClick={() => onProviderSelect('openai')} type="button">
        select openai
      </button>
    </div>
  ),
}));
vi.mock('@/app/[variants]/(main)/settings/provider/detail', () => ({
  default: ({ id }: { id: string }) => <div data-testid="detail">detail {id}</div>,
}));
vi.mock('@/app/[variants]/(main)/settings/provider/_layout/Desktop', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('@/app/[variants]/(main)/settings/provider/(list)/Footer', () => ({
  default: () => null,
}));

const notify = () => window.dispatchEvent(new Event('review-location'));
const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  window.addEventListener('review-location', callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener('review-location', callback);
  };
};

const nativePush = window.history.pushState.bind(window.history);
const nativeReplace = window.history.replaceState.bind(window.history);
const previousNuqs = (window.history as History & { nuqs?: unknown }).nuqs;

window.history.pushState = (...args: Parameters<History['pushState']>) => {
  nativePush(...args);
  notify();
};
window.history.replaceState = (...args: Parameters<History['replaceState']>) => {
  nativeReplace(...args);
  notify();
};

const router = {
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: () => {},
  push: (url: string) => {
    window.history.pushState(null, '', url);
  },
  refresh: () => {},
  replace: (url: string) => {
    window.history.replaceState(null, '', url);
  },
};

function Harness() {
  const href = useSyncExternalStore(
    subscribe,
    () => window.location.href,
    () => window.location.href,
  );
  const url = useMemo(() => new URL(href), [href]);

  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={url.pathname}>
        <SearchParamsContext.Provider value={url.searchParams}>
          <NuqsAdapter>
            {url.pathname === '/settings' ? (
              <>
                <Header activeSettingsKey={SettingsTabs.Provider} />
                <Page mobile />
              </>
            ) : (
              <div data-testid="outside">{url.pathname}</div>
            )}
          </NuqsAdapter>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

const traversed = (direction: 'back' | 'forward') =>
  act(async () => {
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history[direction]();
    });
  });

const select = async () => {
  fireEvent.click(screen.getByText('select openai'));
  await waitFor(() => expect(window.location.search).toContain('provider=openai'), { interval: 1 });
  expect(screen.getByTestId('detail').textContent).toBe('detail openai');
};

beforeEach(() => {
  window.history.replaceState(null, '', '/me/settings');
  window.history.pushState(null, '', '/settings?active=provider');
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  window.history.pushState = nativePush;
  window.history.replaceState = nativeReplace;
  (window.history as History & { nuqs?: unknown }).nuqs = previousNuqs;
});

it('returns from a selected provider to the list, then to main settings', async () => {
  render(<Harness />);
  await select();

  fireEvent.click(screen.getByText('back'));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy());

  await traversed('back');
  expect(window.location.pathname).toBe('/me/settings');
});

it('pops the same detail entry after Back and Forward', async () => {
  render(<Harness />);
  await select();
  await traversed('back');
  expect(screen.getByTestId('list')).toBeTruthy();
  await traversed('forward');
  expect(screen.getByTestId('detail')).toBeTruthy();

  fireEvent.click(screen.getByText('back'));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy());
  await traversed('back');

  expect(window.location.pathname).toBe('/me/settings');
});

it('stays on the provider list when Back happens before the query throttle flushes', async () => {
  render(<Harness />);
  await select();
  fireEvent.click(screen.getByText('back'));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy(), { interval: 1 });

  fireEvent.click(screen.getByText('select openai'));
  expect(screen.getByText('openai')).toBeTruthy();
  expect(window.location.search).toContain('provider=openai');

  fireEvent.click(screen.getByText('back'));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy(), { interval: 1 });
  expect(window.location.pathname).toBe('/settings');
  expect(window.location.search).not.toContain('provider=openai');

  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
  });
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.location.search).not.toContain('provider=openai');

  await traversed('back');
  expect(window.location.pathname).toBe('/me/settings');
});

it('keeps a fresh direct provider visit in Settings on header Back', async () => {
  window.history.replaceState(null, '', '/settings?active=provider&provider=openai');
  render(<Harness />);
  expect(screen.getByTestId('detail')).toBeTruthy();

  fireEvent.click(screen.getByText('back'));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy());
  expect(window.location.pathname).toBe('/settings');
  expect(window.location.search).not.toContain('provider=openai');

  await traversed('back');
  expect(window.location.pathname).toBe('/me/settings');
});
