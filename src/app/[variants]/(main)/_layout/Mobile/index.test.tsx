import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Layout from './index';

const { layoutState } = vi.hoisted(() => ({
  layoutState: {
    pathname: '/image',
    showMobileWorkspace: false,
  },
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => layoutState.pathname,
}));

vi.mock('@/components/withSuspense', () => ({
  withSuspense: (Component: any) => Component,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => layoutState.showMobileWorkspace,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({ showCloudPromotion: false }),
}));

vi.mock('./NavBar', () => ({
  default: () => <nav>Mobile navigation</nav>,
}));

afterEach(() => {
  cleanup();
  layoutState.pathname = '/image';
  layoutState.showMobileWorkspace = false;
});

const renderLayout = () =>
  render(
    <Layout>
      <div>Mobile workspace</div>
    </Layout>,
  );

describe('mobile main layout', () => {
  it('shows the bottom navigation on the Image route', () => {
    renderLayout();

    expect(screen.getByText('Mobile workspace')).toBeTruthy();
    expect(screen.getByRole('navigation').textContent).toContain('Mobile navigation');
  });

  it.each([
    '/knowledge',
    '/knowledge/bases',
    '/knowledge/bases/base-id',
    '/tools',
    '/tools/picbed',
    '/tools/apitest',
  ])('shows the bottom navigation on route family member %s', (pathname) => {
    layoutState.pathname = pathname;

    renderLayout();

    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it.each(['/settings', '/profile', '/toolshed'])(
    'does not show the bottom navigation on unrelated route %s',
    (pathname) => {
      layoutState.pathname = pathname;

      renderLayout();

      expect(screen.queryByRole('navigation')).toBeNull();
    },
  );

  it('hides the bottom navigation while the mobile workspace is open', () => {
    layoutState.pathname = '/knowledge';
    layoutState.showMobileWorkspace = true;

    renderLayout();

    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
