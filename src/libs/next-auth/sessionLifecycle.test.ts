import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginNextAuthSessionTransition,
  completeNextAuthSessionTransition,
  completeOwnedNextAuthSessionTransition,
  getNextAuthSessionTransitionGeneration,
  isNextAuthSessionTransitionPending,
  runNextAuthSessionTransition,
  runRedirectingNextAuthOAuthTransition,
  runWithNextAuthSessionLock,
} from './sessionLifecycle';

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('NextAuth session lifecycle coordination', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('serializes a replacement auth write after an in-flight session refresh', async () => {
    const releaseRefresh = createDeferred<void>();
    let lockQueue = Promise.resolve();
    const lockRequest = vi.fn(
      async <Result>(_name: string, operation: () => Promise<Result>): Promise<Result> => {
        const previousOperation = lockQueue;
        let releaseOperation!: () => void;
        lockQueue = new Promise<void>((resolve) => {
          releaseOperation = resolve;
        });

        await previousOperation;
        try {
          return await operation();
        } finally {
          releaseOperation();
        }
      },
    );
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: { request: lockRequest },
    });
    const operationOrder: string[] = [];

    const refreshPromise = runWithNextAuthSessionLock(async () => {
      operationOrder.push('refresh-start');
      await releaseRefresh.promise;
      operationOrder.push('refresh-finish');
    });
    await Promise.resolve();

    const authTransitionPromise = runNextAuthSessionTransition(async () => {
      operationOrder.push('auth-write');
    });
    await Promise.resolve();

    expect(operationOrder).toEqual(['refresh-start']);
    expect(isNextAuthSessionTransitionPending()).toBe(true);
    expect(getNextAuthSessionTransitionGeneration()).toBe(1);

    releaseRefresh.resolve();
    await Promise.all([refreshPromise, authTransitionPromise]);

    expect(operationOrder).toEqual(['refresh-start', 'refresh-finish', 'auth-write']);
    expect(isNextAuthSessionTransitionPending()).toBe(false);
  });

  it('ignores the old-session update performed during OAuth preflight', async () => {
    const authorizationUrl = 'https://accounts.example.com/authorize';
    const establishTransaction = createDeferred<string | undefined>();
    const transitionPromise = runRedirectingNextAuthOAuthTransition(
      () => establishTransaction.promise,
    );
    const originalMarker = localStorage.getItem('chathub:next-auth-session-transition');

    completeOwnedNextAuthSessionTransition();

    expect(localStorage.getItem('chathub:next-auth-session-transition')).toBe(originalMarker);
    expect(isNextAuthSessionTransitionPending()).toBe(true);

    establishTransaction.resolve(authorizationUrl);
    await expect(transitionPromise).resolves.toBe(authorizationUrl);

    const callbackMarker = localStorage.getItem('chathub:next-auth-session-transition');
    expect(callbackMarker).not.toBe(originalMarker);

    completeOwnedNextAuthSessionTransition();

    expect(localStorage.getItem('chathub:next-auth-session-transition')).toBe(callbackMarker);
    expect(isNextAuthSessionTransitionPending()).toBe(true);
  });

  it('starts the OAuth callback lifetime after a delayed Auth.js preflight', async () => {
    vi.useFakeTimers();
    const authorizationUrl = 'https://accounts.example.com/authorize';
    const establishTransaction = createDeferred<string | undefined>();
    const transitionPromise = runRedirectingNextAuthOAuthTransition(
      () => establishTransaction.promise,
    );

    expect(getNextAuthSessionTransitionGeneration()).toBe(1);

    await vi.advanceTimersByTimeAsync(30 * 1000);
    establishTransaction.resolve(authorizationUrl);
    await expect(transitionPromise).resolves.toBe(authorizationUrl);

    expect(getNextAuthSessionTransitionGeneration()).toBe(2);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(isNextAuthSessionTransitionPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(isNextAuthSessionTransitionPending()).toBe(false);
  });

  it('does not navigate when a newer auth transition supersedes OAuth preflight', async () => {
    const establishTransaction = createDeferred<string | undefined>();
    const transitionPromise = runRedirectingNextAuthOAuthTransition(
      () => establishTransaction.promise,
    );
    const newerTransitionMarker = beginNextAuthSessionTransition();

    establishTransaction.resolve('https://accounts.example.com/authorize');

    await expect(transitionPromise).resolves.toBeUndefined();
    expect(localStorage.getItem('chathub:next-auth-session-transition')).toBe(
      newerTransitionMarker,
    );
    expect(isNextAuthSessionTransitionPending()).toBe(true);

    completeNextAuthSessionTransition(newerTransitionMarker);
  });

  it('returns the OAuth authorization URL when localStorage is unavailable', async () => {
    vi.useFakeTimers();
    const authorizationUrl = 'https://accounts.example.com/authorize';
    const establishTransaction = createDeferred<string | undefined>();
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    const transitionPromise = runRedirectingNextAuthOAuthTransition(
      () => establishTransaction.promise,
    );
    await vi.advanceTimersByTimeAsync(30 * 1000);
    establishTransaction.resolve(authorizationUrl);
    await expect(transitionPromise).resolves.toBe(authorizationUrl);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(isNextAuthSessionTransitionPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(isNextAuthSessionTransitionPending()).toBe(false);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });
});
