import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import KnowledgeRouteContainer from './KnowledgeRouteContainer';

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => (
    <div data-padding-bottom={style?.paddingBottom ?? ''} data-testid="flexbox">
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('KnowledgeRouteContainer', () => {
  it('renders children in a horizontal container without reserving the mobile tab-bar height', () => {
    render(
      <KnowledgeRouteContainer>
        <div>Knowledge route content</div>
      </KnowledgeRouteContainer>,
    );

    const container = screen.getByTestId('flexbox');
    expect(container.getAttribute('data-padding-bottom')).toBe('');
  });
});
