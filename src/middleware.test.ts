// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { type NextFetchEvent, NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authWrapperMock,
  middlewareSessionCookies,
  nextAuthSession,
  parseDefaultThemeFromCountryMock,
} = vi.hoisted(() => ({
  authWrapperMock: vi.fn(),
  middlewareSessionCookies: [
    '__Secure-authjs.session-token=secure-session; Path=/; HttpOnly; Secure',
    '__Secure-authjs.session-token.0=secure-chunk-zero; Path=/; HttpOnly; Secure',
    'authjs.session-token=insecure-session; Path=/; HttpOnly',
    'authjs.session-token.1=insecure-chunk-one; Path=/; HttpOnly',
  ],
  nextAuthSession: {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'account-a' },
  },
  parseDefaultThemeFromCountryMock: vi.fn(() => 'light'),
}));

vi.mock('@lobechat/utils/server', () => ({
  correctOIDCUrl: (_request: NextRequest, url: URL) => url,
  parseDefaultThemeFromCountry: parseDefaultThemeFromCountryMock,
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    ENABLE_AUTH_PROTECTION: undefined,
    MIDDLEWARE_REWRITE_THROUGH_LOCAL: false,
  },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    NEXT_PUBLIC_ENABLE_CLERK_AUTH: false,
    NEXT_PUBLIC_ENABLE_NEXT_AUTH: true,
  },
}));

vi.mock('@/libs/next-auth', () => ({
  default: {
    auth: authWrapperMock,
  },
}));

vi.mock('@/libs/tokenAuth', () => ({
  resolveTokenAuthUserId: vi.fn(),
}));

vi.mock('./envs/oidc', () => ({
  oidcEnv: {
    ENABLE_OIDC: false,
  },
}));

authWrapperMock.mockImplementation(
  (handler: (request: NextRequest) => Response | Promise<Response>) =>
    async (request: NextRequest) => {
      Object.assign(request, { auth: nextAuthSession });
      const response = await handler(request);

      for (const sessionCookie of middlewareSessionCookies) {
        response.headers.append('set-cookie', sessionCookie);
      }
      response.headers.append(
        'set-cookie',
        '__Secure-authjs.callback-url=https%3A%2F%2Fchathub.example%2Fchat; Path=/; HttpOnly; Secure',
      );

      return response;
    },
);

const createNextFetchEvent = (): NextFetchEvent =>
  ({
    passThroughOnException: vi.fn(),
    waitUntil: vi.fn(),
  }) as unknown as NextFetchEvent;

const getCookieNames = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((setCookieHeader) => setCookieHeader.slice(0, setCookieHeader.indexOf('=')));

describe('Middleware route matching', () => {
  it('matches Artifacts so its variant route is reachable', async () => {
    const { config } = await import('./middleware');

    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: 'https://chathub.example/artifacts',
      }),
    ).toBe(true);
  });

  it('rewrites Artifacts to its locale, device, and theme variant', async () => {
    const { default: middleware } = await import('./middleware');
    const request = new NextRequest('https://chathub.example/artifacts?hl=zh-CN', {
      headers: {
        'accept-language': 'en-US',
        'user-agent': 'Mozilla/5.0',
      },
    });

    const response = await middleware(request, createNextFetchEvent());

    expect(response).toBeInstanceOf(Response);
    expect(response?.headers.get('x-middleware-rewrite')).toContain(
      '/zh-CN__0__light/artifacts?hl=zh-CN',
    );
  });

  it('matches the legacy Labs route so its redirect page is reachable', async () => {
    const { config } = await import('./middleware');

    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: 'https://chathub.example/labs',
      }),
    ).toBe(true);
  });
});

describe('NextAuth middleware cookie boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['/api/auth/session-probe', '/chat'])(
    'does not forward session-cookie rotations for %s',
    async (pathname) => {
      const { default: middleware } = await import('./middleware');
      const request = new NextRequest(`https://chathub.example${pathname}`, {
        headers: {
          'accept-language': 'en-US',
          'user-agent': 'Mozilla/5.0',
        },
      });

      const response = await middleware(request, createNextFetchEvent());

      expect(response).toBeInstanceOf(Response);
      expect(getCookieNames(response as Response)).toEqual(['__Secure-authjs.callback-url']);
    },
  );

  it('preserves non-session cookies on a rewritten page response', async () => {
    const { default: middleware } = await import('./middleware');
    const request = new NextRequest('https://chathub.example/chat?hl=zh-CN', {
      headers: {
        'accept-language': 'en-US',
        'user-agent': 'Mozilla/5.0',
      },
    });

    const response = await middleware(request, createNextFetchEvent());

    expect(response).toBeInstanceOf(Response);
    expect(getCookieNames(response as Response)).toEqual([
      'LOBE_LOCALE',
      '__Secure-authjs.callback-url',
    ]);
    expect(response?.headers.get('x-middleware-rewrite')).toContain('/zh-CN__0__light/chat');
  });
});
