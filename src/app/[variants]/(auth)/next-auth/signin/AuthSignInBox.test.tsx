import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getNextAuthSessionTransitionGeneration } from '@/libs/next-auth/sessionLifecycle';

import AuthSignInBox from './AuthSignInBox';

vi.stubGlobal('React', React);

const { push, signIn } = vi.hoisted(() => ({
  push: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('callbackUrl=%2Fchat'),
}));

vi.mock('next-auth/react', () => ({
  signIn,
}));

vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      button: 'button',
      container: 'container',
      contentCard: 'contentCard',
      description: 'description',
      footer: 'footer',
      text: 'text',
      title: 'title',
    },
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    icon: _icon,
    loading,
    type: _type,
    ...props
  }: PropsWithChildren<{
    icon?: ReactNode;
    loading?: boolean;
    onClick?: () => void;
    type?: string;
  }>) => (
    <button aria-busy={loading} type="button" {...props}>
      {children}
    </button>
  ),
  Text: ({ as: Component = 'span', children, ...props }: PropsWithChildren<{ as?: string }>) => (
    <Component {...props}>{children}</Component>
  ),
}));

vi.mock('antd', () => {
  const Layout = ({ children }: PropsWithChildren) => <div>{children}</div>;

  return {
    Col: Layout,
    Divider: Layout,
    Flex: Layout,
    Row: Layout,
    Skeleton: {
      Button: () => <div>loading</div>,
    },
  };
});

vi.mock('@/components/BrandWatermark', () => ({
  default: () => <div>brand</div>,
}));

vi.mock('@/components/Branding', () => ({
  ProductLogo: () => <div>logo</div>,
}));

vi.mock('@/components/NextAuth/AuthIcons', () => ({
  default: () => null,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { oAuthSSOProviders: string[] }) => unknown) =>
    selector({ oAuthSSOProviders: ['github'] }),
}));

vi.mock('./CredentialsForm', () => ({
  default: () => null,
}));

describe('AuthSignInBox', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    push.mockReset();
    signIn.mockReset();
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates only after Auth.js establishes the OAuth transaction', async () => {
    const authorizationUrl = 'https://github.com/login/oauth/authorize';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    signIn.mockResolvedValue({
      code: undefined,
      error: undefined,
      ok: true,
      status: 200,
      url: authorizationUrl,
    });

    render(<AuthSignInBox />);
    fireEvent.click(screen.getByRole('button', { name: 'github' }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('github', {
        redirect: false,
        redirectTo: '/chat',
      });
      expect(getNextAuthSessionTransitionGeneration()).toBe(2);
      expect(assignSpy).toHaveBeenCalledWith(authorizationUrl);
    });
  });

  it('clears the transition and opens the configured error page when OAuth setup fails', async () => {
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    signIn.mockResolvedValue({
      code: undefined,
      error: 'OAuthSignin',
      ok: false,
      status: 500,
      url: null,
    });

    render(<AuthSignInBox />);
    fireEvent.click(screen.getByRole('button', { name: 'github' }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/next-auth/error?error=OAuthSignin');
      expect(localStorage.getItem('chathub:next-auth-session-transition')).toBeNull();
    });
  });

  it('continues to the provider when localStorage is unavailable', async () => {
    const authorizationUrl = 'https://github.com/login/oauth/authorize';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    signIn.mockResolvedValue({
      code: undefined,
      error: undefined,
      ok: true,
      status: 200,
      url: authorizationUrl,
    });

    render(<AuthSignInBox />);
    fireEvent.click(screen.getByRole('button', { name: 'github' }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(authorizationUrl);
      expect(screen.getByRole('button', { name: 'github' }).getAttribute('aria-busy')).toBe('true');
    });
  });
});
