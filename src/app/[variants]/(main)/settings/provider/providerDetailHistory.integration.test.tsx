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
      <button onClick={() => onProviderSelect('moonshot')} type="button">
        select moonshot
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

// Mirrors Next's installed history wrapper: __NA/_N skip search-param sync,
// and an external write does not update React until a later turn. Notifying
// on every write hides the list inside the first click and cannot catch a
// second tap. See next/dist/client/components/app-router.js.
const isNextHistoryBypass = (data: unknown) => {
  if (!data || typeof data !== 'object') return false;
  const state = data as Record<string, unknown>;
  return Boolean(state.__NA || state._N);
};

const storeExternalHistory = (
  method: History['pushState'],
  data: unknown,
  unused: string,
  url?: string | URL | null,
) => {
  if (isNextHistoryBypass(data)) {
    method.call(window.history, data, unused, url);
    return;
  }
  const state: Record<string, unknown> =
    data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {};
  const current = window.history.state;
  if (current && typeof current === 'object') {
    if (current.__NA) state.__NA = current.__NA;
    if (current.__PRIVATE_NEXTJS_INTERNALS_TREE) {
      state.__PRIVATE_NEXTJS_INTERNALS_TREE = current.__PRIVATE_NEXTJS_INTERNALS_TREE;
    }
  }
  method.call(window.history, state, unused, url);
  if (url) setTimeout(notify, 0);
};

window.history.pushState = (data, unused, url) => {
  storeExternalHistory(nativePush, data, unused, url);
};
window.history.replaceState = (data, unused, url) => {
  storeExternalHistory(nativeReplace, data, unused, url);
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
  nativeReplace({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['settings'] }, '', '/me/settings');
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

  fireEvent.click(screen.getByRole('button', { name: 'select openai' }));
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.location.search).toContain('provider=openai');

  fireEvent.click(screen.getByRole('button', { name: 'back' }));
  await waitFor(() => expect(window.location.search).not.toContain('provider=openai'), {
    interval: 1,
  });
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.location.pathname).toBe('/settings');

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

const returnToListInOneBack = async (listHistoryLength: number) => {
  await waitFor(() => expect(screen.getByTestId('detail')).toBeTruthy());
  expect(window.history.length).toBe(listHistoryLength + 1);

  fireEvent.click(screen.getByRole('button', { name: 'back' }));
  await waitFor(() => expect(screen.getByTestId('list')).toBeTruthy());
  expect(window.location.pathname).toBe('/settings');
  expect(window.location.search).not.toContain('provider=');

  await traversed('back');
  expect(window.location.pathname).toBe('/me/settings');
};

it('creates one detail entry when the same visible row is tapped twice', async () => {
  render(<Harness />);
  expect(screen.getByTestId('list')).toBeTruthy();
  const listHistoryLength = window.history.length;

  fireEvent.click(screen.getByRole('button', { name: 'select openai' }));
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.history.length).toBe(listHistoryLength + 1);

  fireEvent.click(screen.getByRole('button', { name: 'select openai' }));
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.history.length).toBe(listHistoryLength + 1);

  await returnToListInOneBack(listHistoryLength);
});

it('creates one detail entry when two different visible rows are tapped', async () => {
  render(<Harness />);
  expect(screen.getByTestId('list')).toBeTruthy();
  const listHistoryLength = window.history.length;

  fireEvent.click(screen.getByRole('button', { name: 'select openai' }));
  expect(screen.getByTestId('list')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'select moonshot' }));
  expect(screen.getByTestId('list')).toBeTruthy();
  expect(window.history.length).toBe(listHistoryLength + 1);

  await waitFor(() => expect(screen.getByTestId('detail').textContent).toBe('detail moonshot'));
  await returnToListInOneBack(listHistoryLength);
});
