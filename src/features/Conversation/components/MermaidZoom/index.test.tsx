import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import MermaidZoom from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// real open/close state; the drawer relies solely on useWorkspaceModal (which
// force-closes on route change), mirroring the HTML preview drawer.
vi.mock('@/hooks/useWorkspaceModal', async () => {
  const react = await import('react');
  return {
    useWorkspaceModal: () => {
      const [open, setOpen] = react.useState(false);
      return [open, (v: boolean) => setOpen(v)];
    },
  };
});

// stub the drawer so the test doesn't pull in SyntaxMermaid / antd Drawer
vi.mock('./MermaidDrawer', async () => {
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

describe('MermaidZoom', () => {
  const renderZoom = () =>
    render(
      <MermaidZoom
        content={'graph TD; A-->B'}
        originalNode={<div data-testid={'diagram'}>svg</div>}
      />,
    );

  it('renders the inline diagram and opens the drawer on click', () => {
    const { getByTestId, queryByTestId } = renderZoom();
    expect(getByTestId('diagram')).not.toBeNull();
    expect(queryByTestId('drawer-close')).toBeNull();

    // clicking the diagram bubbles to the trigger and opens the drawer
    fireEvent.click(getByTestId('diagram'));
    expect(queryByTestId('drawer-close')).not.toBeNull();
  });

  it('opens the drawer via the Enter key on the trigger', () => {
    const { getByTestId, queryByTestId } = renderZoom();
    fireEvent.keyDown(getByTestId('diagram').parentElement as Element, { key: 'Enter' });
    expect(queryByTestId('drawer-close')).not.toBeNull();
  });

  it('closes the drawer via onClose', () => {
    const { getByTestId, queryByTestId } = renderZoom();
    fireEvent.click(getByTestId('diagram'));
    fireEvent.click(getByTestId('drawer-close'));
    expect(queryByTestId('drawer-close')).toBeNull();
  });
});
