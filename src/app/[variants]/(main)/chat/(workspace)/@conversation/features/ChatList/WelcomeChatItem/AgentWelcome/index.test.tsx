import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import InboxWelcome from './index';

vi.stubGlobal('React', React);

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@lobehub/ui', () => ({
  FluentEmoji: () => null,
  Markdown: ({
    children,
    customRender,
  }: {
    children: React.ReactNode;
    customRender: (node: React.ReactNode, context: { text: string }) => React.ReactNode;
  }) => <>{customRender(<>{children}</>, { text: String(children) })}</>,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: { container: 'container', desc: 'desc', title: 'title' } }),
}));

vi.mock('react-i18next', () => ({
  Trans: ({ components }: { components: { plus: React.ReactNode } }) => <>{components.plus}</>,
  useTranslation: () => ({
    t: (key: string) =>
      key === 'guide.defaultMessage'
        ? 'Welcome. Create an assistant with <plus />.'
        : 'Welcome without assistant creation.',
  }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useGreeting', () => ({ useGreeting: () => 'Welcome' }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@/libs/swr', () => ({ useActionSWR: () => ({ isValidating: false, mutate: vi.fn() }) }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    openingMessage: () => undefined,
    openingQuestions: () => [],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: { showInboxWelcome: () => true },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: { showCreateSession: boolean }) => state,
  useServerConfigStore: (selector: (state: { showCreateSession: boolean }) => unknown) =>
    selector({ showCreateSession: true }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionMetaSelectors: { currentAgentMeta: () => ({}) },
}));

vi.mock('./AddButton', () => ({
  default: () => <button aria-label="welcome-create-assistant" type="button" />,
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

describe('InboxWelcome', () => {
  beforeEach(() => {
    setVerifiedAccount();
  });

  it('hides embedded assistant creation when account recovery is required', () => {
    render(<InboxWelcome />);

    expect(screen.getByRole('button', { name: 'welcome-create-assistant' })).not.toBeNull();

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

    expect(screen.queryByRole('button', { name: 'welcome-create-assistant' })).toBeNull();
  });
});
