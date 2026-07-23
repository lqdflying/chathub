import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import Layout from './index';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/image',
}));

vi.mock('@/components/withSuspense', () => ({
  withSuspense: (Component: any) => Component,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => false,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({ showCloudPromotion: false }),
}));

vi.mock('./NavBar', () => ({
  default: () => <nav>Mobile navigation</nav>,
}));

describe('mobile main layout', () => {
  it('shows the bottom navigation on the Image route', () => {
    render(
      <Layout>
        <div>Image workspace</div>
      </Layout>,
    );

    expect(screen.getByText('Image workspace')).toBeTruthy();
    expect(screen.getByRole('navigation').textContent).toContain('Mobile navigation');
  });
});
