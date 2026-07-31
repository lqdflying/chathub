import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDevBypassUserId } from './devAuth';

describe('resolveDevBypassUserId', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves the configured mock user for headerless development requests', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');

    expect(resolveDevBypassUserId(new Headers())).toBe('account-a');
  });

  it('uses one fallback identity when no mock user id is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');

    expect(resolveDevBypassUserId(new Headers())).toBe('DEV_USER');
  });

  it('accepts matching secret headers and rejects a mismatched secret', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS_SECRET', 'expected-secret');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');

    expect(
      resolveDevBypassUserId(
        new Headers({
          'lobe-auth-dev-backend-api': '1',
          'lobe-auth-dev-secret': 'expected-secret',
        }),
      ),
    ).toBe('account-a');
    expect(
      resolveDevBypassUserId(
        new Headers({
          'lobe-auth-dev-backend-api': '1',
          'lobe-auth-dev-secret': 'wrong-secret',
        }),
      ),
    ).toBeUndefined();
  });

  it('never enables the bypass outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');

    expect(resolveDevBypassUserId(new Headers())).toBeUndefined();
  });
});
