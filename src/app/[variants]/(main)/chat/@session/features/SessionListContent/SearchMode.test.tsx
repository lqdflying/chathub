import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SearchMode from './SearchMode';

vi.stubGlobal('React', React);

const { serverConfigState, sessionStoreState } = vi.hoisted(() => ({
  serverConfigState: { isMobile: false },
  sessionStoreState: {
    sessionSearchKeywords: 'assistant',
    useSearchSessions: vi.fn(),
  },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    isMobile: (state: typeof serverConfigState) => state.isMobile,
  },
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}));

vi.mock('../SkeletonList', () => ({
  default: () => <div>search-loading</div>,
}));

vi.mock('./AssistantListBootstrapGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="assistant-list-bootstrap-guard">{children}</div>
  ),
}));

vi.mock('./List', () => ({
  default: ({ dataSource }: { dataSource?: Array<{ id: string }> }) => (
    <div>{dataSource?.map((session) => session.id).join(',')}</div>
  ),
}));

describe('SearchMode', () => {
  beforeEach(() => {
    sessionStoreState.useSearchSessions = vi.fn(() => ({
      data: [{ id: 'assistant-a', type: 'agent' }],
      isLoading: false,
    }));
  });

  it('keeps searched assistant results inside the bootstrap guard', () => {
    render(<SearchMode />);

    const guard = screen.getByTestId('assistant-list-bootstrap-guard');
    expect(guard.textContent).toContain('assistant-a');
  });

  it('keeps search loading inside the bootstrap guard', () => {
    sessionStoreState.useSearchSessions = vi.fn(() => ({
      data: undefined,
      isLoading: true,
    }));

    render(<SearchMode />);

    const guard = screen.getByTestId('assistant-list-bootstrap-guard');
    expect(guard.textContent).toContain('search-loading');
  });
});
