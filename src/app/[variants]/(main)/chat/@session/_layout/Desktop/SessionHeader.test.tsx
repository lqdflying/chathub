import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import SessionHeader from './SessionHeader';

vi.stubGlobal('React', React);

const { createGroupMock, createSessionMock } = vi.hoisted(() => ({
  createGroupMock: vi.fn(),
  createSessionMock: vi.fn(),
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
    <button type="button" {...props} />
  ),
  Dropdown: ({
    children,
    menu,
  }: {
    children: React.ReactNode;
    menu?: { items?: Array<{ key: string; label: string; onClick?: () => void }> };
  }) => (
    <>
      {children}
      {menu?.items?.map((item) => (
        <button key={item.key} onClick={item.onClick} type="button">
          {item.label}
        </button>
      ))}
    </>
  ),
  Icon: () => null,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: { logo: 'logo', top: 'top' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Branding', () => ({
  ProductLogo: () => <div>logo</div>,
}));

vi.mock('@/components/ChatGroupWizard', () => ({
  ChatGroupWizard: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="group-wizard" />
  ),
}));

vi.mock('@/components/ChatGroupWizard/templates', () => ({
  useGroupTemplates: () => [],
}));

vi.mock('@/libs/swr', () => ({
  useActionSWR: () => ({ isValidating: false, mutate: vi.fn() }),
}));

vi.mock('@/store/chatGroup', () => ({
  useChatGroupStore: (selector: (state: { createGroup: typeof createGroupMock }) => unknown) =>
    selector({ createGroup: createGroupMock }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: { enableGroupChat: boolean; showCreateSession: boolean }) => state,
  useServerConfigStore: (
    selector: (state: { enableGroupChat: boolean; showCreateSession: boolean }) => unknown,
  ) => selector({ enableGroupChat: true, showCreateSession: true }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { createSession: typeof createSessionMock }) => unknown) =>
    selector({ createSession: createSessionMock }),
}));

vi.mock('../../../features/TogglePanelButton', () => ({
  default: () => <button type="button">toggle-panel</button>,
}));

vi.mock('../../features/SessionSearchBar', () => ({
  default: () => <div>search</div>,
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

describe('desktop SessionHeader', () => {
  beforeEach(() => {
    setVerifiedAccount();
  });

  it('hides assistant creation while authenticated ownership is pending', () => {
    render(<SessionHeader />);

    expect(screen.getByRole('button', { name: 'newAgent' })).not.toBeNull();

    act(() => {
      useUserStore.setState({
        isUserStateInit: false,
        userStateScope: undefined,
      });
    });

    expect(screen.queryByRole('button', { name: 'newAgent' })).toBeNull();
    expect(screen.getByRole('button', { name: 'toggle-panel' })).not.toBeNull();
  });

  it('closes an open group wizard when assistant creation readiness is lost', () => {
    render(<SessionHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'newGroupChat' }));
    expect(screen.getByTestId('group-wizard').dataset.open).toBe('true');

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

    expect(screen.queryByTestId('group-wizard')).toBeNull();

    act(() => {
      setVerifiedAccount();
    });

    expect(screen.getByTestId('group-wizard').dataset.open).toBe('false');
  });
});
