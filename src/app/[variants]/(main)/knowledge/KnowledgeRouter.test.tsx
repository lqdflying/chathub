import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeRouter from './KnowledgeRouter';

vi.mock('antd', () => ({
  App: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => (
    <div data-testid="knowledge-root" style={style}>
      {children}
    </div>
  ),
}));

vi.mock('./components/RagProviderBanner', () => ({
  default: () => <div data-testid="rag-banner" />,
}));
vi.mock('./routes/KnowledgeBaseDetail', () => ({
  default: () => (
    <>
      <aside data-testid="knowledge-sidebar" />
      <main data-testid="knowledge-content" />
    </>
  ),
}));
vi.mock('./routes/KnowledgeBasesList', () => ({ default: () => <div /> }));
vi.mock('./routes/KnowledgeHome', () => ({ default: () => <div /> }));

describe('KnowledgeRouter', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/knowledge/bases/kb-1');
  });

  it('keeps the banner above a horizontal route viewport', () => {
    render(<KnowledgeRouter />);

    const root = screen.getByTestId('knowledge-root');
    const banner = screen.getByTestId('rag-banner');
    const viewport = screen.getByTestId('knowledge-route-viewport');
    const sidebar = screen.getByTestId('knowledge-sidebar');
    const content = screen.getByTestId('knowledge-content');

    expect(root.style.display).toBe('flex');
    expect(root.style.flexDirection).toBe('column');
    expect(root.style.minHeight).toBe('0');
    expect(viewport.style.display).toBe('flex');
    expect(viewport.style.flexDirection).toBe('row');
    expect(viewport.style.minHeight).toBe('0');
    expect(viewport.style.overflow).toBe('hidden');
    expect(banner.parentElement).toBe(root);
    expect(viewport.parentElement).toBe(root);
    expect(sidebar.parentElement).toBe(viewport);
    expect(content.parentElement).toBe(viewport);
  });
});
