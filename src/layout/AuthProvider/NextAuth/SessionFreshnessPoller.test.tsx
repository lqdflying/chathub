import { act, render } from '@testing-library/react';
import type { Session } from 'next-auth';
import React, { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SessionFreshnessPoller from './SessionFreshnessPoller';

vi.stubGlobal('React', React);

type NextAuthSessionState =
  | { data: Session; status: 'authenticated' }
  | { data: null; status: 'loading' | 'unauthenticated' };

const { nextAuthSessionStore, signOutMock } = vi.hoisted(() => {
  let currentSession: NextAuthSessionState = {
    data: {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'account-a' },
    },
    status: 'authenticated',
  };
  const listeners = new Set<() => void>();

  return {
    nextAuthSessionStore: {
      getSnapshot: () => currentSession,
      setSession: (nextSession: NextAuthSessionState) => {
        currentSession = nextSession;
        listeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    signOutMock: vi.fn(),
  };
});

vi.mock('next-auth/react', () => ({
  signOut: signOutMock,
  useSession: () =>
    useSyncExternalStore(
      nextAuthSessionStore.subscribe,
      nextAuthSessionStore.getSnapshot,
      nextAuthSessionStore.getSnapshot,
    ),
}));

const createSession = (accountId: string): Session => ({
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: accountId },
});

const createDeferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online,
  });
};

const advanceToNextPoll = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  });
};

describe('SessionFreshnessPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nextAuthSessionStore.setSession({
      data: createSession('account-a'),
      status: 'authenticated',
    });
    setOnline(true);
    signOutMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('signs out after an online probe confirms there is no session', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue(null),
      ok: true,
    } as unknown as Response);
    signOutMock.mockResolvedValue(undefined);

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
  });

  it('preserves the current session when the probe returns an authenticated session', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ user: { id: 'account-a' } }),
      ok: true,
    } as unknown as Response);

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).toHaveBeenCalledOnce();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an HTTP failure',
      {
        json: vi.fn(),
        ok: false,
      },
    ],
    [
      'a malformed response',
      {
        json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
        ok: true,
      },
    ],
  ])('preserves the current session after %s', async (_caseName, response) => {
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).toHaveBeenCalledOnce();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('does not probe while the browser reports an offline connection', async () => {
    setOnline(false);

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('does not schedule polling for an unauthenticated session', async () => {
    nextAuthSessionStore.setSession({ data: null, status: 'unauthenticated' });

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('aborts and ignores an account-A probe after account B becomes active', async () => {
    const deferredResponse = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValue(deferredResponse.promise);

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    const requestSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(false);

    act(() => {
      nextAuthSessionStore.setSession({
        data: createSession('account-b'),
        status: 'authenticated',
      });
    });

    expect(requestSignal?.aborted).toBe(true);

    deferredResponse.resolve({
      json: vi.fn().mockResolvedValue(null),
      ok: true,
    } as unknown as Response);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signOutMock).not.toHaveBeenCalled();
  });
});
