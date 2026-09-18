import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const RAW_MESSAGE = {
  content: 'unchanged wrapping text',
  createdAt: 1,
  id: 'message',
  role: 'assistant' as const,
  updatedAt: 1,
};

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, never>) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageMeta: () => ({}),
    getRawMessageById: () => () => RAW_MESSAGE,
    isMessageLoading: () => () => false,
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ cx: (...classNames: string[]) => classNames.filter(Boolean).join(' '), styles: { loading: '', message: '' } }),
}));

vi.mock('./Assistant', () => ({
  default: () => <div data-testid="assistant-child">plain message text</div>,
}));

vi.mock('./User', () => ({ default: () => null }));
vi.mock('./Supervisor', () => ({ default: () => null }));
vi.mock('../components/History', () => ({ default: () => null }));

import Item from './index';

const resizeCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallbacks.push(callback);
  }

  disconnect() {
    const index = resizeCallbacks.indexOf(this.callback);
    if (index >= 0) resizeCallbacks.splice(index, 1);
  }

  observe() {}
  unobserve() {}
}

const notifyResize = () => {
  act(() => {
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
  });
};

describe('ChatItem idle row height cache', () => {
  let measuredHeight = 1200;

  beforeEach(() => {
    measuredHeight = 1200;
    resizeCallbacks.length = 0;
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return {
        bottom: measuredHeight,
        height: measuredHeight,
        left: 0,
        right: 160,
        toJSON() {
          return {};
        },
        top: 0,
        width: 160,
        x: 0,
        y: 0,
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the resized idle height when scrolling starts, not the first sample', () => {
    const { container, rerender } = render(<Item id="message" index={0} />);

    measuredHeight = 240;
    notifyResize();

    rerender(<Item id="message" index={0} isScrolling />);

    const row = container.querySelector('[data-index="0"]') as HTMLElement;
    expect(row.style.minHeight).toBe('240px');
  });

  it('records a child-only idle height change without replacing the message', () => {
    const { container, rerender } = render(<Item id="message" index={0} />);

    measuredHeight = 180;
    notifyResize();

    rerender(<Item id="message" index={0} isScrolling />);

    const row = container.querySelector('[data-index="0"]') as HTMLElement;
    expect(row.style.minHeight).toBe('180px');
  });

  it('does not record light-scroll geometry into the idle cache', () => {
    const { container, rerender } = render(<Item id="message" index={0} />);

    measuredHeight = 240;
    notifyResize();

    rerender(<Item id="message" index={0} isScrolling />);
    measuredHeight = 80;
    notifyResize();

    const row = container.querySelector('[data-index="0"]') as HTMLElement;
    expect(row.style.minHeight).toBe('240px');
  });
});
