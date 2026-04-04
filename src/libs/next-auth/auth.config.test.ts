// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('auth.config session maxAge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/config/db');
    vi.doUnmock('@/envs/auth');
    vi.doUnmock('./adapter');
    vi.doUnmock('./sso-providers');
  });

  it('defaults jwt session maxAge to 30 days', async () => {
    vi.doMock('@/config/db', () => ({
      getServerDBConfig: () => ({ NEXT_PUBLIC_ENABLED_SERVER_SERVICE: true }),
    }));
    vi.doMock('@/envs/auth', () => ({
      authEnv: {},
      getAuthConfig: () => ({
        AUTH_SESSION_MAX_AGE_DAYS: 30,
        NEXT_AUTH_DEBUG: false,
        NEXT_AUTH_SECRET: 'secret',
        NEXT_AUTH_SSO_PROVIDERS: 'credentials',
        NEXT_AUTH_SSO_SESSION_STRATEGY: 'jwt',
        NEXT_PUBLIC_ENABLE_NEXT_AUTH: true,
      }),
    }));
    vi.doMock('./adapter', () => ({
      LobeNextAuthDbAdapter: () => ({ mocked: true }),
    }));
    vi.doMock('./sso-providers', () => ({
      ssoProviders: [{ id: 'credentials', provider: { id: 'credentials' } }],
    }));

    const module = await import('./auth.config');

    expect(module.default.session?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it('uses AUTH_SESSION_MAX_AGE_DAYS when set', async () => {
    vi.doMock('@/config/db', () => ({
      getServerDBConfig: () => ({ NEXT_PUBLIC_ENABLED_SERVER_SERVICE: true }),
    }));
    vi.doMock('@/envs/auth', () => ({
      authEnv: {},
      getAuthConfig: () => ({
        AUTH_SESSION_MAX_AGE_DAYS: 7,
        NEXT_AUTH_DEBUG: false,
        NEXT_AUTH_SECRET: 'secret',
        NEXT_AUTH_SSO_PROVIDERS: 'credentials',
        NEXT_AUTH_SSO_SESSION_STRATEGY: 'jwt',
        NEXT_PUBLIC_ENABLE_NEXT_AUTH: true,
      }),
    }));
    vi.doMock('./adapter', () => ({
      LobeNextAuthDbAdapter: () => ({ mocked: true }),
    }));
    vi.doMock('./sso-providers', () => ({
      ssoProviders: [{ id: 'credentials', provider: { id: 'credentials' } }],
    }));

    const module = await import('./auth.config');

    expect(module.default.session?.maxAge).toBe(60 * 60 * 24 * 7);
  });
});