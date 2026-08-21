import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatHeaderTitle from './ChatHeaderTitle';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} onClick={onClick} type="button" />
  ),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: {
    Title: ({ desc, title }: { desc: React.ReactNode; title: React.ReactNode }) => (
      <div>
        <div data-testid="session-title">{title}</div>
        <div data-testid="topic-title">{desc}</div>
      </div>
    ),
  },
}));

vi.mock('antd-style', () => ({
  createStyles:
    (fn: (helpers: { css: (strings: TemplateStringsArray) => string }) => Record<string, string>) =>
    () => ({
      styles: fn({ css: () => 'truncated-text' }),
    }),
  useTheme: () => ({ colorFillSecondary: '#eee', colorTextDescription: '#666' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { topicLength: number; topic?: { title: string } }) => unknown) =>
    selector({ topicLength: 2, topic: { title: 'ITSM Design Review Request' } }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopic: (s: { topic?: { title: string } }) => s.topic,
    currentTopicLength: (s: { topicLength: number }) => s.topicLength,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleMobileTopic: () => void }) => unknown) =>
    selector({ toggleMobileTopic: vi.fn() }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (
    selector: (state: { isInbox: boolean; title: string }) => unknown,
  ) => selector({ isInbox: true, title: 'Just Chat' }),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionMetaSelectors: {
    currentAgentTitle: (s: { title: string }) => s.title,
  },
  sessionSelectors: {
    isInboxSession: (s: { isInbox: boolean }) => s.isInbox,
  },
}));

describe('mobile ChatHeaderTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates the topic subtitle without attaching pointer events to the text', () => {
    render(<ChatHeaderTitle />);

    const topicText = screen.getByText('ITSM Design Review Request');
    expect(topicText.tagName).toBe('SPAN');
    expect(topicText.className).toContain('truncated-text');
  });
});
