import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import SessionHeader from './SessionHeader';

vi.stubGlobal('React', React);

const { createSessionMock, pushMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    icon: _icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button aria-label="create-assistant" type="button" {...props} />
  ),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({ colorBgContainer: '#fff', colorBorderSecondary: '#ddd' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Branding', () => ({
  ProductLogo: () => <div>logo</div>,
}));

vi.mock('@/features/User/UserAvatar', () => ({
  default: () => <button type="button">avatar</button>,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: { showCreateSession: boolean }) => state,
  useServerConfigStore: (selector: (state: { showCreateSession: boolean }) => unknown) =>
    selector({ showCreateSession: true }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { createSession: typeof createSessionMock }) => unknown) =>
    selector({ createSession: createSessionMock }),
}));

const setVerifiedAccount = () => {
  useUserStore.setState({
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    user: { id: 'account-a' },
    userStateInitializationFailure: undefined,
    userStateScope: 'user:account-a',
  });
};

describe('mobile SessionHeader', () => {
  beforeEach(() => {
    setVerifiedAccount();
  });

  it('hides assistant creation while account bootstrap recovery is required', () => {
    render(<SessionHeader />);

    expect(screen.getByRole('button', { name: 'create-assistant' })).not.toBeNull();

    act(() => {
      useUserStore.setState({
        isUserStateInit: false,
        userStateInitializationFailure: {
          reason: 'request-failed',
          scope: 'user:account-a',
        },
        userStateScope: undefined,
      });
    });

    expect(screen.queryByRole('button', { name: 'create-assistant' })).toBeNull();
  });
});
