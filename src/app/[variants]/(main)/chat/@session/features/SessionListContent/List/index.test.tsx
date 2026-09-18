import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  isMobile: true,
  showMobileWorkspace: true,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => mocks.showMobileWorkspace,
}));

vi.mock('@/hooks/useSwitchSession', () => ({
  useSwitchSession: () => vi.fn(),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (s: any) => s.featureFlags,
  useServerConfigStore: (selector: any) =>
    selector({
      featureFlags: { showCreateSession: false },
      isMobile: mocks.isMobile,
    }),
}));

vi.mock('@/store/session', () => ({
  getSessionStoreState: () => ({}),
  useSessionStore: (selector: any) =>
    typeof selector === 'function' ? selector({ isSessionListInit: true }) : true,
}));

vi.mock('@/store/session/selectors', () => ({
  sessionGroupSelectors: {},
  sessionSelectors: { isSessionListInit: () => true },
}));

vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => ({ analytics: undefined }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../SkeletonList', () => ({
  default: () => null,
}));

vi.mock('./AddButton', () => ({
  default: () => null,
}));

vi.mock('./Item', () => ({
  default: () => null,
}));

vi.mock('react-lazy-load', () => ({
  default: ({ children }: { children: unknown }) => children,
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: unknown }) => children,
}));

import SessionList from './index';

describe('mobile SessionList', () => {
  it('does not render session rows while the workspace is shown', () => {
    mocks.isMobile = true;
    mocks.showMobileWorkspace = true;

    render(<SessionList dataSource={[{ id: 's1' } as any]} />);

    expect(screen.queryByLabelText('s1')).toBeNull();
  });
});
