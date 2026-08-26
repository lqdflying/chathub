import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownRender } from './index';

vi.stubGlobal('React', React);

const openMessageDetail = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: {
      badge: 'badge',
      clickable: 'clickable',
      container: 'container',
      preview: 'preview',
      remove: 'remove',
    },
  }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { openMessageDetail: typeof openMessageDetail }) => unknown) =>
    selector({ openMessageDetail }),
}));

const tenLines = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

describe('User MarkdownRender pasted cards', () => {
  beforeEach(() => {
    openMessageDetail.mockClear();
  });

  it('keeps ordinary short text as markdown', () => {
    render(
      <MarkdownRender
        displayMode={'chat'}
        dom={<div>full markdown</div>}
        id={'msg-1'}
        text={'hello'}
      />,
    );

    expect(screen.getByText('full markdown')).toBeTruthy();
    expect(screen.queryByText('chatList.pasted')).toBeNull();
  });

  it('shows a compact PASTED card for a 10-line dump', async () => {
    const user = userEvent.setup();
    render(
      <MarkdownRender
        displayMode={'chat'}
        dom={<div>full markdown</div>}
        id={'msg-2'}
        text={tenLines}
      />,
    );

    expect(screen.queryByText('full markdown')).toBeNull();
    expect(screen.getByRole('button', { name: 'chatList.pastedAria' })).toBeTruthy();
    expect(screen.getByText('chatList.pasted')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'chatList.pastedAria' }));
    expect(openMessageDetail).toHaveBeenCalledWith('msg-2');
  });

  it('shows a compact PASTED card for a 1000-character dump', () => {
    render(
      <MarkdownRender
        displayMode={'chat'}
        dom={<div>full markdown</div>}
        id={'msg-3'}
        text={'a'.repeat(1000)}
      />,
    );

    expect(screen.queryByText('full markdown')).toBeNull();
    expect(screen.getByText('chatList.pasted')).toBeTruthy();
  });
});
