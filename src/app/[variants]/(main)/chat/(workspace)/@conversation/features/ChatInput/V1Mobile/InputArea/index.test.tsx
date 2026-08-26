import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import MobileChatInputArea from './index';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  TextArea: (props: {
    onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
    onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
    onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  }) => (
    <textarea
      data-testid="composer"
      onBlur={props.onBlur}
      onFocus={props.onFocus}
      onPaste={props.onPaste}
    />
  ),
}));

vi.mock('@lobehub/ui/mobile', () => ({
  SafeArea: () => null,
}));

vi.mock('ahooks', () => ({
  useSize: () => ({ height: 40 }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: { container: '', expand: '', expandButton: '', textarea: '' },
  }),
  css: () => '',
  cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('V1Mobile InputArea pasted chips', () => {
  it('keeps pasted chips visible while the composer is focused', () => {
    render(
      <MobileChatInputArea
        pastedAddons={<div data-testid="chip">chip</div>}
        topAddons={<div data-testid="addons">addons</div>}
        value=""
      />,
    );

    expect(screen.getByTestId('chip')).toBeTruthy();
    expect(screen.getByTestId('addons')).toBeTruthy();

    fireEvent.focus(screen.getByTestId('composer'));

    expect(screen.getByTestId('chip')).toBeTruthy();
    expect(screen.getByTestId('addons').parentElement?.style.display).toBe('none');
  });
});
