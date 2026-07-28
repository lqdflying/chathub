import { act, render } from '@testing-library/react';
import type { Session } from 'next-auth';
import React, { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginNextAuthSessionTransition,
  completeNextAuthSessionTransition,
  completeOwnedNextAuthSessionTransition,
} from '@/libs/next-auth/sessionLifecycle';

import SessionFreshnessPoller from './SessionFreshnessPoller';

vi.stubGlobal('React', React);

type NextAuthSessionState =
  | { data: Session; status: 'authenticated' }
  | { data: null; status: 'loading' | 'unauthenticated' };

const { nextAuthSessionStore } = vi.hoisted(() => {
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
  };
});

vi.mock('next-auth/react', () => ({
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

const flushImmediateProbe = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const createJsonResponse = (body: unknown, ok = true): Response =>
  ({
    json: vi.fn().mockResolvedValue(body),
    ok,
  }) as unknown as Response;

describe('SessionFreshnessPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    nextAuthSessionStore.setSession({
      data: createSession('account-a'),
      status: 'authenticated',
    });
    setOnline(true);
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(
          async <Result,>(_name: string, operation: () => Promise<Result>): Promise<Result> =>
            operation(),
        ),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reconciles a confirmed logout without a second session request', async () => {
    const onReconcileSession = vi.fn();
    vi.mocked(fetch).mockResolvedValue(createJsonResponse({ session: null }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/auth/session-probe', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(onReconcileSession).toHaveBeenCalledOnce();
    expect(onReconcileSession).toHaveBeenCalledWith(null);
  });

  it('renews a matching authenticated session through the explicit refresh boundary', async () => {
    const activeSession = createSession('account-a');
    const refreshedSession = {
      ...activeSession,
      expires: new Date(Date.now() + 120_000).toISOString(),
    };
    const onReconcileSession = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce(createJsonResponse({ session: activeSession }))
      .mockResolvedValueOnce(createJsonResponse({ session: activeSession }))
      .mockResolvedValueOnce(createJsonResponse(refreshedSession));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();

    await advanceToNextPoll();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'x-chathub-session-refresh': '1',
      },
      signal: expect.any(AbortSignal),
    });
    expect(onReconcileSession).not.toHaveBeenCalled();
  });

  it('reconciles when the probe belongs to another authenticated account', async () => {
    const accountBSession = createSession('account-b');
    const onReconcileSession = vi.fn();
    vi.mocked(fetch).mockResolvedValue(createJsonResponse({ session: accountBSession }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();
    expect(onReconcileSession).toHaveBeenCalledWith(accountBSession);
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
    [
      'a malformed identity',
      {
        json: vi.fn().mockResolvedValue({ session: { user: { id: 42 } } }),
        ok: true,
      },
    ],
  ])('preserves the current session after %s', async (_caseName, response) => {
    const onReconcileSession = vi.fn();
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();
    expect(onReconcileSession).not.toHaveBeenCalled();
  });

  it('does not probe while the browser reports an offline connection', async () => {
    const onReconcileSession = vi.fn();
    setOnline(false);

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).not.toHaveBeenCalled();
    expect(onReconcileSession).not.toHaveBeenCalled();
  });

  it('reconciles a replacement login from an unauthenticated server snapshot', async () => {
    const onReconcileSession = vi.fn();
    const accountBSession = createSession('account-b');
    nextAuthSessionStore.setSession({ data: null, status: 'unauthenticated' });
    vi.mocked(fetch).mockResolvedValue(createJsonResponse({ session: accountBSession }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();
    expect(onReconcileSession).toHaveBeenCalledWith(accountBSession);

    await advanceToNextPoll();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not probe while the initial session is loading', async () => {
    const onReconcileSession = vi.fn();
    nextAuthSessionStore.setSession({ data: null, status: 'loading' });

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    expect(fetch).not.toHaveBeenCalled();
    expect(onReconcileSession).not.toHaveBeenCalled();
  });

  it('aborts and ignores an account-A probe after account B becomes active', async () => {
    const onReconcileSession = vi.fn();
    const deferredResponse = createDeferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(deferredResponse.promise)
      .mockResolvedValueOnce(createJsonResponse({ session: createSession('account-b') }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    const requestSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(false);

    act(() => {
      nextAuthSessionStore.setSession({
        data: createSession('account-b'),
        status: 'authenticated',
      });
    });
    await flushImmediateProbe();

    expect(requestSignal?.aborted).toBe(true);

    deferredResponse.resolve({
      json: vi.fn().mockResolvedValue({ session: null }),
      ok: true,
    } as unknown as Response);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReconcileSession).not.toHaveBeenCalled();
  });

  it('does not renew after an auth transition begins while the probe is in flight', async () => {
    const onReconcileSession = vi.fn();
    const deferredResponse = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValue(deferredResponse.promise);

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    const transitionMarker = beginNextAuthSessionTransition();

    deferredResponse.resolve({
      json: vi.fn().mockResolvedValue({ session: createSession('account-a') }),
      ok: true,
    } as unknown as Response);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(onReconcileSession).not.toHaveBeenCalled();

    completeNextAuthSessionTransition(transitionMarker);
  });

  it('reconciles immediately after this tab completes an auth transition', async () => {
    const accountASession = createSession('account-a');
    const accountBSession = createSession('account-b');
    const onReconcileSession = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce(createJsonResponse({ session: accountASession }))
      .mockResolvedValueOnce(createJsonResponse({ session: accountBSession }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    beginNextAuthSessionTransition();
    completeOwnedNextAuthSessionTransition();
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onReconcileSession).toHaveBeenCalledWith(accountBSession);
  });

  it('queues reconciliation when a transition completes during an older probe', async () => {
    const accountBSession = createSession('account-b');
    const accountCSession = createSession('account-c');
    const deferredResponse = createDeferred<Response>();
    const onReconcileSession = vi.fn();
    vi.mocked(fetch)
      .mockReturnValueOnce(deferredResponse.promise)
      .mockResolvedValueOnce(createJsonResponse({ session: accountCSession }));

    render(<SessionFreshnessPoller onReconcileSession={onReconcileSession} />);
    await flushImmediateProbe();

    beginNextAuthSessionTransition();
    completeOwnedNextAuthSessionTransition();
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledOnce();

    deferredResponse.resolve(createJsonResponse({ session: accountBSession }));
    await flushImmediateProbe();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onReconcileSession).toHaveBeenCalledOnce();
    expect(onReconcileSession).toHaveBeenCalledWith(accountCSession);
  });
});
