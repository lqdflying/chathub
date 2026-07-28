import { render, screen } from '@testing-library/react';
import React, { type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import NextAuth from './index';

const sessionProviderProps = vi.hoisted(() => ({
  basePath: undefined as string | undefined,
  refetchOnWindowFocus: undefined as boolean | undefined,
  refetchWhenOffline: undefined as boolean | undefined,
}));

vi.mock('next-auth/react', () => ({
  SessionProvider: ({
    basePath,
    children,
    refetchOnWindowFocus,
    refetchWhenOffline,
  }: PropsWithChildren<{
    basePath?: string;
    refetchOnWindowFocus?: boolean;
    refetchWhenOffline?: boolean;
  }>) => {
    sessionProviderProps.basePath = basePath;
    sessionProviderProps.refetchOnWindowFocus = refetchOnWindowFocus;
    sessionProviderProps.refetchWhenOffline = refetchWhenOffline;

    return <>{children}</>;
  },
}));

vi.mock('./SessionFreshnessPoller', () => ({
  default: () => <div>session-freshness-poller</div>,
}));

vi.mock('./UserUpdater', () => ({
  default: () => <div>user-updater</div>,
}));

describe('NextAuth provider', () => {
  it('polls online while avoiding focus and offline revalidation', () => {
    render(
      <NextAuth>
        <div>protected-content</div>
      </NextAuth>,
    );

    expect(screen.getByText('protected-content')).not.toBeNull();
    expect(screen.getByText('session-freshness-poller')).not.toBeNull();
    expect(screen.getByText('user-updater')).not.toBeNull();
    expect(sessionProviderProps.basePath).toBe('/api/auth');
    expect(sessionProviderProps.refetchOnWindowFocus).toBe(false);
    expect(sessionProviderProps.refetchWhenOffline).toBe(false);
  });
});
