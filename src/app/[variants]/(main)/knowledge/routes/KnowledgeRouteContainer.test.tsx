import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_TABBAR_SAFE_HEIGHT } from '@/const/layoutTokens';

import KnowledgeRouteContainer from './KnowledgeRouteContainer';

const { responsiveState } = vi.hoisted(() => ({
  responsiveState: {
    isMobile: true,
  },
}));

vi.mock('react-responsive', () => ({
  useMediaQuery: () => responsiveState.isMobile,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => (
    <div data-padding-bottom={style?.paddingBottom}>{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  responsiveState.isMobile = true;
});

describe('KnowledgeRouteContainer', () => {
  it('reserves the mobile tab-bar safe height', () => {
    render(
      <KnowledgeRouteContainer>
        <div>Knowledge route content</div>
      </KnowledgeRouteContainer>,
    );

    const container = screen.getByText('Knowledge route content').parentElement;
    expect(container?.getAttribute('data-padding-bottom')).toBe(MOBILE_TABBAR_SAFE_HEIGHT);
  });

  it('does not add mobile navigation padding on desktop', () => {
    responsiveState.isMobile = false;

    render(
      <KnowledgeRouteContainer>
        <div>Knowledge route content</div>
      </KnowledgeRouteContainer>,
    );

    const container = screen.getByText('Knowledge route content').parentElement;
    expect(container?.getAttribute('data-padding-bottom')).toBeNull();
  });
});
