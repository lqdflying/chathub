import type { Session } from '@auth/core/types';
import { act, render, waitFor } from '@testing-library/react';
import React, { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

import UserUpdater from './UserUpdater';

type SessionState = {
  data: Session | null;
  status: 'authenticated' | 'loading' | 'unauthenticated';
};

const nextAuthSessionStore = vi.hoisted(() => {
  let currentSession: SessionState = {
    data: null,
    status: 'loading',
  };
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => currentSession,
    reset: () => {
      currentSession = {
        data: null,
        status: 'loading',
      };
    },
    setSession: (nextSession: SessionState) => {
      currentSession = nextSession;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('next-auth/react', () => ({
  useSession: () =>
    useSyncExternalStore(
      nextAuthSessionStore.subscribe,
      nextAuthSessionStore.getSnapshot,
      nextAuthSessionStore.getSnapshot,
    ),
}));

describe('NextAuth UserUpdater', () => {
  beforeEach(() => {
    nextAuthSessionStore.reset();
    useUserStore.setState(initialState, true);
  });

  it('keeps auth unresolved while the initial session is loading', () => {
    render(<UserUpdater />);

    expect(useUserStore.getState().isLoaded).toBe(false);
    expect(useUserStore.getState().isSignedIn).toBe(false);
    expect(useUserStore.getState().authUserId).toBeUndefined();
  });

  it('propagates authenticated and genuine unauthenticated session states', async () => {
    nextAuthSessionStore.setSession({
      data: createSession('account-a'),
      status: 'authenticated',
    });
    render(<UserUpdater />);

    await waitFor(() => {
      const authenticatedState = useUserStore.getState();
      expect(authenticatedState.isLoaded).toBe(true);
      expect(authenticatedState.isSignedIn).toBe(true);
      expect(authenticatedState.authUserId).toBe('account-a');
      expect(authenticatedState.user?.id).toBe('account-a');
    });

    act(() => {
      nextAuthSessionStore.setSession({
        data: null,
        status: 'unauthenticated',
      });
    });

    await waitFor(() => {
      const unauthenticatedState = useUserStore.getState();
      expect(unauthenticatedState.isLoaded).toBe(true);
      expect(unauthenticatedState.isSignedIn).toBe(false);
      expect(unauthenticatedState.authUserId).toBeUndefined();
    });
  });
});

const createSession = (userId: string): Session => ({
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: {
    email: `${userId}@example.com`,
    id: userId,
    name: `User ${userId}`,
  },
});
