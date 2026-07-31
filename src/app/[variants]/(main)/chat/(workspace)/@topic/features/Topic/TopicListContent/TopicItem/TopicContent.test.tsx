import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicContent from './TopicContent';

const openTopicInNewWindow = vi.fn();

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon: _icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} />
  ),
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  EditableText: () => null,
  Icon: () => null,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ modal: { confirm: vi.fn() } }) },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: { content: 'content', title: 'title' },
    theme: { colorTextDescription: '#999', colorWarning: '#fa0' },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/BubblesLoading', () => ({ default: () => null }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        activeId: 'assistant-id',
        autoRenameTopicTitle: vi.fn(),
        duplicateTopic: vi.fn(),
        favoriteTopic: vi.fn(),
        removeTopic: vi.fn(),
        topicRenamingId: '',
        updateTopicTitle: vi.fn(),
      }),
    { setState: vi.fn() },
  ),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { isTopicLoading: () => () => false },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openTopicInNewWindow }),
}));

vi.mock('@/store/global/selectors', () => ({
  globalGeneralSelectors: { currentLanguage: () => 'en-US' },
}));

describe('TopicContent', () => {
  it('shows the exact localized last-activity timestamp', () => {
    const lastActivityAt = new Date(2026, 6, 29, 14, 35).getTime();
    const { container } = render(
      <TopicContent id="topic-id" lastActivityAt={lastActivityAt} title="Azure costs" />,
    );

    const time = container.querySelector('time');

    expect(time?.textContent).toBe('Jul 29, 2026, 2:35 PM');
    expect(time?.getAttribute('dateTime')).toBe(new Date(lastActivityAt).toISOString());
    expect(time?.textContent).not.toContain('ago');
  });
});
