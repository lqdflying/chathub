import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SessionFreshnessPoller from './SessionFreshnessPoller';

vi.stubGlobal('React', React);

const { nextAuthState, signOutMock } = vi.hoisted(() => ({
  nextAuthState: {
    status: 'authenticated' as 'authenticated' | 'loading' | 'unauthenticated',
  },
  signOutMock: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  signOut: signOutMock,
  useSession: () => ({ status: nextAuthState.status }),
}));

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
    nextAuthState.status = 'authenticated';
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
    nextAuthState.status = 'unauthenticated';

    render(<SessionFreshnessPoller />);
    await advanceToNextPoll();

    expect(fetch).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
