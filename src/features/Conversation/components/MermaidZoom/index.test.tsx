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

  it('exposes exactly one open control with the translated accessible name', () => {
    const { getAllByRole, getByRole } = renderZoom();
    // the corner glyph is presentational (aria-hidden), so the wrapper is the
    // sole focusable button — no nested interactive roles
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(getByRole('button', { name: 'Mermaid.actions.open' })).toBe(buttons[0]);
  });

  it('renders the inline diagram and opens the drawer on click', () => {
    const { getByTestId, queryByTestId } = renderZoom();
    expect(getByTestId('diagram')).not.toBeNull();
    expect(queryByTestId('drawer-close')).toBeNull();

    // clicking the diagram bubbles to the trigger and opens the drawer
    fireEvent.click(getByTestId('diagram'));
    expect(queryByTestId('drawer-close')).not.toBeNull();
  });

  it('opens the drawer with Enter from the open control', () => {
    const { getByRole, queryByTestId } = renderZoom();
    fireEvent.keyDown(getByRole('button', { name: 'Mermaid.actions.open' }), { key: 'Enter' });
    expect(queryByTestId('drawer-close')).not.toBeNull();
  });

  it('opens the drawer with Space from the open control', () => {
    const { getByRole, queryByTestId } = renderZoom();
    fireEvent.keyDown(getByRole('button', { name: 'Mermaid.actions.open' }), { key: ' ' });
    expect(queryByTestId('drawer-close')).not.toBeNull();
  });

  it('closes the drawer via onClose', () => {
    const { getByTestId, queryByTestId } = renderZoom();
    fireEvent.click(getByTestId('diagram'));
    fireEvent.click(getByTestId('drawer-close'));
    expect(queryByTestId('drawer-close')).toBeNull();
  });
});
