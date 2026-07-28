import { act, render, screen } from '@testing-library/react';
import type { Session } from 'next-auth';
import React, { type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import NextAuth from './index';

const sessionProviderProps = vi.hoisted(() => ({
  basePath: undefined as string | undefined,
  mountCount: 0,
  refetchOnWindowFocus: undefined as boolean | undefined,
  refetchWhenOffline: undefined as boolean | undefined,
  session: undefined as Session | null | undefined,
}));
const pollerProps = vi.hoisted(() => ({
  onReconcileSession: undefined as ((session: Session | null) => void) | undefined,
}));

vi.mock('next-auth/react', () => ({
  SessionProvider: ({
    basePath,
    children,
    refetchOnWindowFocus,
    refetchWhenOffline,
    session,
  }: PropsWithChildren<{
    basePath?: string;
    refetchOnWindowFocus?: boolean;
    refetchWhenOffline?: boolean;
    session?: Session | null;
  }>) => {
    sessionProviderProps.mountCount += 1;
    sessionProviderProps.basePath = basePath;
    sessionProviderProps.refetchOnWindowFocus = refetchOnWindowFocus;
    sessionProviderProps.refetchWhenOffline = refetchWhenOffline;
    sessionProviderProps.session = session;

    return <>{children}</>;
  },
}));

vi.mock('./SessionFreshnessPoller', () => ({
  default: ({ onReconcileSession }: { onReconcileSession: (session: Session | null) => void }) => {
    pollerProps.onReconcileSession = onReconcileSession;
    return <div>session-freshness-poller</div>;
  },
}));

vi.mock('./UserUpdater', () => ({
  default: () => <div>user-updater</div>,
}));

describe('NextAuth provider', () => {
  it('hydrates from the server snapshot while avoiding automatic session revalidation', () => {
    const initialSession: Session = {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'account-a' },
    };
    sessionProviderProps.mountCount = 0;
    render(
      <NextAuth initialSession={initialSession}>
        <div>protected-content</div>
      </NextAuth>,
    );

    expect(screen.getByText('protected-content')).not.toBeNull();
    expect(screen.getByText('session-freshness-poller')).not.toBeNull();
    expect(screen.getByText('user-updater')).not.toBeNull();
    expect(sessionProviderProps.basePath).toBe('/api/auth');
    expect(sessionProviderProps.refetchOnWindowFocus).toBe(false);
    expect(sessionProviderProps.refetchWhenOffline).toBe(false);
    expect(sessionProviderProps.session).toBe(initialSession);
    expect(sessionProviderProps.mountCount).toBe(1);
  });

  it('replaces an authenticated provider snapshot after confirmed server logout', () => {
    const initialSession: Session = {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'account-a' },
    };
    sessionProviderProps.mountCount = 0;

    render(
      <NextAuth initialSession={initialSession}>
        <div>protected-content</div>
      </NextAuth>,
    );

    act(() => {
      pollerProps.onReconcileSession?.(null);
    });

    expect(sessionProviderProps.session).toBeNull();
    expect(sessionProviderProps.mountCount).toBe(2);
  });
});
