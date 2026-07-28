// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_REFRESH_HEADER,
  SESSION_REFRESH_HEADER_VALUE,
} from '@/libs/next-auth/sessionConstants';

import { GET } from './route';

const { authGetMock } = vi.hoisted(() => ({
  authGetMock: vi.fn(),
}));

vi.mock('@/libs/next-auth', () => ({
  default: {
    handlers: {
      GET: authGetMock,
      POST: vi.fn(),
    },
  },
}));

const SESSION_COOKIE = '__Secure-authjs.session-token=rotated-session; Path=/; HttpOnly; Secure';
const CALLBACK_COOKIE =
  '__Secure-authjs.callback-url=https%3A%2F%2Fchathub.example%2Fchat; Path=/; HttpOnly; Secure';

const createAuthResponse = (): Response => {
  const headers = new Headers();
  headers.append('set-cookie', SESSION_COOKIE);
  headers.append('set-cookie', CALLBACK_COOKIE);

  return Response.json(
    {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'account-a' },
    },
    { headers },
  );
};

const getCookieNames = (response: Response): string[] =>
  response.headers
    .getSetCookie()
    .map((setCookieHeader) => setCookieHeader.slice(0, setCookieHeader.indexOf('=')));

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetMock.mockImplementation(createAuthResponse);
  });

  it('keeps ordinary bootstrap and client session reads cookie-neutral', async () => {
    const request = new NextRequest('https://chathub.example/api/auth/session');

    const response = await GET(request);

    expect(authGetMock).toHaveBeenCalledWith(request);
    expect(getCookieNames(response)).toEqual(['__Secure-authjs.callback-url']);
  });

  it('allows the lock-serialized keep-alive request to extend session expiry', async () => {
    const request = new NextRequest('https://chathub.example/api/auth/session', {
      headers: {
        [SESSION_REFRESH_HEADER]: SESSION_REFRESH_HEADER_VALUE,
      },
    });

    const response = await GET(request);

    expect(getCookieNames(response)).toEqual([
      '__Secure-authjs.session-token',
      '__Secure-authjs.callback-url',
    ]);
  });
});
