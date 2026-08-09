import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABBAR_SAFE_HEIGHT } from '@/const/layoutTokens';

import KnowledgeHomePage from './index';

const { knowledgeLayoutState } = vi.hoisted(() => ({
  knowledgeLayoutState: {
    showMobileWorkspace: false,
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: { main: 'main' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-responsive', () => ({
  useMediaQuery: () => true,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => (
    <div
      data-display={style?.display || ''}
      data-padding-bottom={style?.paddingBottom || ''}
      data-testid="flexbox"
    >
      {children}
    </div>
  ),
}));

vi.mock('@/components/NProgress', () => ({
  default: () => null,
}));

vi.mock('@/components/PanelTitle', () => ({
  default: () => <div>File panel title</div>,
}));

vi.mock('@/features/FileManager', () => ({
  default: () => <div>File workspace</div>,
}));

vi.mock('@/features/FileSidePanel', () => ({
  default: ({ children }: React.PropsWithChildren) => <aside>{children}</aside>,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => knowledgeLayoutState.showMobileWorkspace,
}));

vi.mock('../../hooks/useFileCategory', () => ({
  useFileCategory: () => ['all'],
}));

vi.mock('../../shared/FileModalQueryRoute', () => ({
  default: () => null,
}));

vi.mock('./layout/Container', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('./layout/RegisterHotkeys', () => ({
  default: () => null,
}));

vi.mock('./menu/FileMenu', () => ({
  default: () => <div>File menu</div>,
}));

vi.mock('./menu/KnowledgeBase', () => ({
  default: () => <div>Knowledge bases</div>,
}));

afterEach(() => {
  cleanup();
  knowledgeLayoutState.showMobileWorkspace = false;
});

describe('Knowledge home mobile layout', () => {
  it('reserves the tab-bar safe height on the visible menu surface', () => {
    render(<KnowledgeHomePage />);

    const menuSurface = screen
      .getAllByTestId('flexbox')
      .find(
        (container) =>
          container.getAttribute('data-padding-bottom') === MOBILE_TABBAR_SAFE_HEIGHT,
      );
    expect(menuSurface).toBeTruthy();
    expect(screen.getByText('File workspace').parentElement?.getAttribute('data-display')).toBe(
      'none',
    );
  });

  it('keeps the full-screen file workspace unpadded while mobile navigation is hidden', () => {
    knowledgeLayoutState.showMobileWorkspace = true;

    render(<KnowledgeHomePage />);

    const menuSurface = screen
      .getAllByTestId('flexbox')
      .find((container) => container.getAttribute('data-display') === 'none');
    const workspaceSurface = screen.getByText('File workspace').parentElement;

    expect(menuSurface).toBeTruthy();
    expect(workspaceSurface?.getAttribute('data-padding-bottom')).toBe('');
  });
});
