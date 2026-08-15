import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HtmlPreviewAction from './HtmlPreviewAction';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// mobile so the history wiring engages
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: true }),
}));

// mimic use-merge-value: a FRESH setter is returned on every render, so the
// effect must NOT depend on it (that was the round-10 rerender-churn bug)
vi.mock('@/hooks/useWorkspaceModal', async () => {
  const react = await import('react');
  return {
    useWorkspaceModal: () => {
      const [open, setOpen] = react.useState(false);
      return [open, (v: boolean) => setOpen(v)];
    },
  };
});

// stub the drawer so it doesn't pull in its own store/theme deps
vi.mock('./PreviewDrawer', async () => {
  const react = await import('react');
  return {
    default: ({ open, onClose }: { onClose: () => void; open: boolean }) =>
      open
        ? react.createElement(
            'button',
            { 'data-testid': 'drawer-close', 'onClick': onClose, 'type': 'button' },
            'drawer',
          )
        : null,
  };
});

describe('HtmlPreviewAction (mobile history)', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushSpy = vi.spyOn(window.history, 'pushState');
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => {
    pushSpy.mockRestore();
    backSpy.mockRestore();
  });

  const openDrawer = (el: HTMLElement) =>
    fireEvent.click(el.querySelector('[role="button"]') as Element);

  it('pushes exactly one history entry and keeps it across content rerenders', () => {
    const { container, rerender } = render(<HtmlPreviewAction content={'<html>a'} />);
    openDrawer(container);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="drawer-close"]')).not.toBeNull();

    // a streaming content update must not churn the history stack
    rerender(<HtmlPreviewAction content={'<html>ab'} />);
    rerender(<HtmlPreviewAction content={'<html>abc'} />);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
    // and the drawer is still open
    expect(container.querySelector('[data-testid="drawer-close"]')).not.toBeNull();
  });

  it('closes on phone Back (popstate) without popping again', () => {
    const { container } = render(<HtmlPreviewAction content={'<html>a'} />);
    openDrawer(container);
    expect(container.querySelector('[data-testid="drawer-close"]')).not.toBeNull();

    fireEvent(window, new PopStateEvent('popstate'));

    expect(container.querySelector('[data-testid="drawer-close"]')).toBeNull();
    // Back already consumed our entry — don't call back() again
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('pops exactly the owned entry when closed via the X', () => {
    const { container } = render(<HtmlPreviewAction content={'<html>a'} />);
    openDrawer(container);

    fireEvent.click(container.querySelector('[data-testid="drawer-close"]') as Element);

    expect(container.querySelector('[data-testid="drawer-close"]')).toBeNull();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
