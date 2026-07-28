import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock('@/libs/next-auth', () => ({
  default: {
    auth: authMock,
  },
}));

describe('GET /api/auth/session-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the authenticated session snapshot without forwarding session cookies', async () => {
    const session = {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: {
        email: 'private@example.com',
        id: 'account-a',
        name: 'Private User',
      },
    };
    authMock.mockResolvedValue(session);

    const response = await GET();

    expect(authMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ session });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns a confirmed signed-out snapshot without forwarding cookie cleanup', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET();

    await expect(response.json()).resolves.toEqual({ session: null });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
