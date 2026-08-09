import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChunkDrawer from './index';

vi.mock('antd', () => ({
  Drawer: ({ mobile, width, title }: any) => (
    <div
      data-mobile={String(!!mobile)}
      data-testid="chunk-drawer"
      title={typeof title === 'string' ? title : ''}
      width={width}
    />
  ),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: { getFileById: () => () => ({ name: 'inventory.xlsx' }) },
  useFileStore: (selector: (state: unknown) => unknown) =>
    selector({
      chunkDetailId: 'file-1',
      closeChunkDrawer: vi.fn(),
    }),
}));

vi.mock('./Content', () => ({
  default: () => <div data-testid="chunk-content" />,
}));

describe('ChunkDrawer responsive width', () => {
  it('opens at full viewport width in mobile mode', () => {
    render(<ChunkDrawer mobile />);

    const drawer = screen.getByTestId('chunk-drawer');
    expect(drawer.getAttribute('width')).toBe('100%');
  });

  it('opens at 60% width on desktop', () => {
    render(<ChunkDrawer />);

    const drawer = screen.getByTestId('chunk-drawer');
    expect(drawer.getAttribute('width')).toBe('60%');
  });
});
