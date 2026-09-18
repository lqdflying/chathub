import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import MobileChatInputArea from './index';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  TextArea: (props: {
    onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
    onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
    onCompositionEnd?: React.CompositionEventHandler<HTMLTextAreaElement>;
    onCompositionStart?: React.CompositionEventHandler<HTMLTextAreaElement>;
    onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
    onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
    value?: string;
  }) => (
    <textarea
      data-testid="composer"
      onBlur={props.onBlur}
      onChange={props.onChange}
      onCompositionEnd={props.onCompositionEnd}
      onCompositionStart={props.onCompositionStart}
      onFocus={props.onFocus}
      onPaste={props.onPaste}
      value={props.value}
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

  it('does not call onInput during IME composition', () => {
    const onInput = vi.fn();
    render(<MobileChatInputArea onInput={onInput} value="" />);

    const composer = screen.getByTestId('composer');
    fireEvent.compositionStart(composer);
    fireEvent.change(composer, { target: { value: '你' } });

    expect(onInput).not.toHaveBeenCalled();

    fireEvent.compositionEnd(composer, { currentTarget: { value: '你好' }, target: { value: '你好' } });

    expect(onInput).toHaveBeenCalledWith('你好');
  });
});
