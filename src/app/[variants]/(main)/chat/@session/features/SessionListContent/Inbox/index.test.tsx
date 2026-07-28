import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Inbox from './index';

vi.stubGlobal('React', React);

const { chatStoreState, serverConfigState, sessionStoreState, switchSessionMock } = vi.hoisted(
  () => ({
    chatStoreState: {
      inboxMessages: [{ id: 'message-a' }],
      openNewTopicOrSaveTopic: vi.fn(),
    },
    serverConfigState: { isMobile: false },
    sessionStoreState: { activeId: 'inbox' },
    switchSessionMock: vi.fn(),
  }),
);

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useSwitchSession', () => ({
  useSwitchSession: () => switchSessionMock,
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: () => chatStoreState,
  useChatStore: (selector: (state: typeof chatStoreState) => unknown) => selector(chatStoreState),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    inboxActiveTopicMessages: (state: typeof chatStoreState) => state.inboxMessages,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}));

vi.mock('../ListItem', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('Inbox', () => {
  beforeEach(() => {
    chatStoreState.inboxMessages = [{ id: 'message-a' }];
    chatStoreState.openNewTopicOrSaveTopic = vi.fn();
    serverConfigState.isMobile = false;
    sessionStoreState.activeId = 'inbox';
    switchSessionMock.mockReset();
  });

  it('cancels a pending assistant URL before opening a new desktop Inbox topic', async () => {
    render(<Inbox />);

    fireEvent.click(screen.getByRole('link', { name: 'inbox.title' }));

    expect(switchSessionMock).toHaveBeenCalledOnce();
    expect(switchSessionMock).toHaveBeenCalledWith('inbox');
    expect(chatStoreState.openNewTopicOrSaveTopic).toHaveBeenCalledOnce();
    expect(switchSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      chatStoreState.openNewTopicOrSaveTopic.mock.invocationCallOrder[0],
    );
  });

  it('routes to Inbox without creating a topic when another assistant is active', () => {
    sessionStoreState.activeId = 'assistant-a';

    render(<Inbox />);

    fireEvent.click(screen.getByRole('link', { name: 'inbox.title' }));

    expect(switchSessionMock).toHaveBeenCalledWith('inbox');
    expect(chatStoreState.openNewTopicOrSaveTopic).not.toHaveBeenCalled();
  });
});
