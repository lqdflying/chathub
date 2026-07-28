import { act, renderHook } from '@testing-library/react';
import { mutate } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

// 定义一个变量来存储 enableAuth 的值
let enableAuth = false;

let enableClerk = false;

let enableNextAuth = false;

// 模拟 @/const/auth 模块
vi.mock('@/const/auth', () => ({
  get enableAuth() {
    return enableAuth;
  },
  get enableClerk() {
    return enableClerk;
  },
  get enableNextAuth() {
    return enableNextAuth;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  enableNextAuth = false;
  enableClerk = false;
  enableAuth = false;
});

/**
 * Mock nextauth 库相关方法
 */
vi.mock('next-auth/react', async () => {
  return {
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
});

describe('createAuthSlice', () => {
  describe('refreshUserState', () => {
    it('should refresh user config', async () => {
      enableAuth = true;
      useUserStore.setState({
        authUserId: 'user-id',
        isLoaded: true,
        isSignedIn: true,
        userStateScope: 'user:user-id',
      });
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshUserState();
      });

      expect(mutate).toHaveBeenCalledWith([
        'initUserState',
        'user:user-id',
        ['account-cache-epoch', 0],
      ]);
    });
  });

  describe('logout', () => {
    it('should call clerkSignOut when Clerk is enabled', async () => {
      enableClerk = true;

      const clerkSignOutMock = vi.fn();
      useUserStore.setState({ clerkSignOut: clerkSignOutMock });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(clerkSignOutMock).toHaveBeenCalled();
    });

    it('should not call clerkSignOut when Clerk is disabled', async () => {
      const clerkSignOutMock = vi.fn();
      useUserStore.setState({ clerkSignOut: clerkSignOutMock });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(clerkSignOutMock).not.toHaveBeenCalled();
    });

    it('should call next-auth signOut when NextAuth is enabled', async () => {
      enableAuth = true;
      enableNextAuth = true;

      const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

      const { signOut } = await import('next-auth/react');
      vi.mocked(signOut).mockResolvedValue({ url: 'http://0.0.0.0:33210/next-auth/signin' } as any);

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(signOut).toHaveBeenCalledWith({
        redirect: false,
        redirectTo: '/next-auth/signin',
      });
      expect(assignSpy).toHaveBeenCalledWith('/next-auth/signin');
      expect(localStorage.getItem('chathub:next-auth-session-transition')).not.toBeNull();
      enableNextAuth = false;
    });

    it('should not call next-auth signOut when NextAuth is disabled', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      const { signOut } = await import('next-auth/react');

      expect(signOut).not.toHaveBeenCalled();
    });
  });

  describe('openLogin', () => {
    it('should call clerkSignIn when Clerk is enabled', async () => {
      enableClerk = true;
      const clerkSignInMock = vi.fn();
      useUserStore.setState({ clerkSignIn: clerkSignInMock });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(clerkSignInMock).toHaveBeenCalled();
    });
    it('should not call clerkSignIn when Clerk is disabled', async () => {
      const clerkSignInMock = vi.fn();
      useUserStore.setState({ clerkSignIn: clerkSignInMock });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(clerkSignInMock).not.toHaveBeenCalled();
    });

    it('should redirect to the credentials sign-in page when NextAuth credentials is enabled', async () => {
      enableNextAuth = true;
      useUserStore.setState({ oAuthSSOProviders: ['credentials'] });

      const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).not.toHaveBeenCalled();
      expect(assignSpy).toHaveBeenCalledWith('/next-auth/signin?callbackUrl=%2F');
      enableNextAuth = false;
    });

    it('should call next-auth signIn directly when credentials provider is not enabled', async () => {
      enableNextAuth = true;
      useUserStore.setState({ oAuthSSOProviders: ['github'] });

      const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).toHaveBeenCalledWith('github');
      expect(assignSpy).not.toHaveBeenCalled();
      enableNextAuth = false;
    });
    it('should not call next-auth signIn when NextAuth is disabled', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).not.toHaveBeenCalled();
    });
  });
});
