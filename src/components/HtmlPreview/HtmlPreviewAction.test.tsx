import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import HtmlPreviewAction from './HtmlPreviewAction';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// real open/close state, mobile-agnostic — the drawer now relies solely on
// useWorkspaceModal (which force-closes on route change), no custom history.
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

describe('HtmlPreviewAction', () => {
  const clickEye = (el: HTMLElement) =>
    fireEvent.click(el.querySelector('[role="button"]') as Element);

  it('opens the preview drawer when the eye icon is clicked', () => {
    const { container } = render(<HtmlPreviewAction content={'<html>a'} />);
    expect(container.querySelector('[data-testid="drawer-close"]')).toBeNull();

    clickEye(container);

    expect(container.querySelector('[data-testid="drawer-close"]')).not.toBeNull();
  });

  it('closes the drawer via onClose without ejecting the route', () => {
    const { container } = render(<HtmlPreviewAction content={'<html>a'} />);
    clickEye(container);

    fireEvent.click(container.querySelector('[data-testid="drawer-close"]') as Element);

    expect(container.querySelector('[data-testid="drawer-close"]')).toBeNull();
  });
});
