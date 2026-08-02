import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import BottomActions from './BottomActions';

vi.stubGlobal('React', React);

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title }: { title: React.ReactNode }) => <span>{title}</span>,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({ hideGitHub: false }),
}));

vi.mock('./PHLaunch', () => ({
  default: () => <span>Product Hunt</span>,
}));

describe('BottomActions', () => {
  it('does not expose the retired Labs destination', () => {
    render(<BottomActions />);

    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.queryByText('labs')).toBeNull();
    expect(screen.queryByRole('link', { name: 'labs' })).toBeNull();
  });
});
