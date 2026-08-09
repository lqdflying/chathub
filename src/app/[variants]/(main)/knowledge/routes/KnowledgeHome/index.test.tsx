import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import KnowledgeHomePage from './index';

const { categoryState } = vi.hoisted(() => ({
  categoryState: { category: 'all' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.replace('tab.', '') }),
}));

vi.mock('@/components/NProgress', () => ({ default: () => null }));
vi.mock('@/components/PanelTitle', () => ({ default: () => <div>File panel title</div> }));

vi.mock('@/features/FileManager', () => ({
  default: ({ category, mobile, title }: any) => (
    <div
      data-category={category ?? ''}
      data-mobile={String(!!mobile)}
      data-testid="file-manager"
      title={title}
    />
  ),
}));

vi.mock('@/features/FileSidePanel', () => ({
  default: ({ children }: React.PropsWithChildren) => <aside>{children}</aside>,
}));

vi.mock('../../hooks/useFileCategory', () => ({
  useFileCategory: () => [categoryState.category],
}));

vi.mock('../../shared/FileModalQueryRoute', () => ({ default: () => null }));
vi.mock('./layout/Container', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('./layout/RegisterHotkeys', () => ({ default: () => null }));
vi.mock('./menu/FileMenu', () => ({ default: () => <div>File menu</div> }));
vi.mock('./menu/KnowledgeBase', () => ({ default: () => <div>Knowledge bases</div> }));

afterEach(() => {
  cleanup();
  categoryState.category = 'all';
});

describe('Knowledge home page', () => {
  it('renders the desktop layout with the desktop file manager and menu surface', () => {
    render(<KnowledgeHomePage />);

    const manager = screen.getByTestId('file-manager');
    expect(manager.getAttribute('data-mobile')).toBe('false');
    expect(manager.getAttribute('data-category')).toBe('all');
    expect(screen.getByText('File menu')).toBeTruthy();
    expect(screen.getByText('Knowledge bases')).toBeTruthy();
  });

  it('renders the compact mobile file manager without the desktop menu surface', () => {
    render(<KnowledgeHomePage mobile />);

    const manager = screen.getByTestId('file-manager');
    expect(manager.getAttribute('data-mobile')).toBe('true');
    expect(screen.queryByText('File menu')).toBeNull();
    expect(screen.queryByText('Knowledge bases')).toBeNull();
  });

  it('threads the active category into the file manager title', () => {
    categoryState.category = 'documents';

    render(<KnowledgeHomePage mobile />);

    const manager = screen.getByTestId('file-manager');
    expect(manager.getAttribute('data-category')).toBe('documents');
    expect(manager.getAttribute('title')).toBe('documents');
  });
});
