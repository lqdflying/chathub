import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SendButton from './SendButton';

vi.stubGlobal('React', React);

const buttonState = vi.hoisted(() => ({
  disabled: false,
  generating: false,
  handleSendButton: vi.fn(),
  handleStop: vi.fn(),
}));

vi.mock('@lobehub/editor/react', () => ({
  SendButton: ({ generating }: { generating?: boolean }) => (
    <button
      data-generating={String(Boolean(generating))}
      data-testid={'editor-send'}
      type={'button'}
    />
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    icon,
    onClick,
    type,
    ...rest
  }: {
    'children'?: React.ReactNode;
    'icon'?: React.ReactNode;
    'onClick'?: () => void;
    'type'?: string;
    'data-testid'?: string;
  }) => (
    <button data-testid={rest['data-testid']} data-type={type} onClick={onClick} type={'button'}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('../store', () => ({
  selectors: {
    sendButtonProps: (state: { sendButtonProps?: { disabled?: boolean; generating?: boolean } }) =>
      state.sendButtonProps,
  },
  useChatInputStore: (selector: (state: unknown) => unknown) =>
    selector({
      handleSendButton: buttonState.handleSendButton,
      handleStop: buttonState.handleStop,
      sendButtonProps: {
        disabled: buttonState.disabled,
        generating: buttonState.generating,
        onStop: buttonState.handleStop,
      },
    }),
}));

describe('SendButton', () => {
  beforeEach(() => {
    buttonState.disabled = false;
    buttonState.generating = false;
    buttonState.handleSendButton.mockReset();
    buttonState.handleStop.mockReset();
  });

  it('renders the CSS stop control while generating and does not mount the editor spinner', () => {
    buttonState.generating = true;

    const { container } = render(<SendButton />);

    expect(screen.getByTestId('chat-send-stop').getAttribute('data-type')).toBe('primary');
    const arc = screen.getByTestId('chat-send-stop-arc');
    expect(arc.getAttribute('class')).toBeTruthy();
    expect(container.querySelector('animateTransform')).toBeNull();
    expect(screen.queryByTestId('editor-send')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-send-stop'));

    expect(buttonState.handleStop).toHaveBeenCalledTimes(1);
    expect(buttonState.handleSendButton).not.toHaveBeenCalled();
  });

  it('renders the editor send button when the turn is idle', () => {
    render(<SendButton />);

    expect(screen.getByTestId('editor-send').getAttribute('data-generating')).toBe('false');
    expect(screen.queryByTestId('chat-send-stop')).toBeNull();
  });
});
