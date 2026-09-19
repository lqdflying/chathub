/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  connected: vi.fn(),
  logout: vi.fn(),
  poll: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('antd', () => ({
  Progress: () => null,
  Tag: () => null,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: {} }),
}));

vi.mock('lucide-react', () => ({
  CircleHelpIcon: () => null,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/accountMutation', () => ({
  captureSensitiveAccountMutationSnapshot: () => ({
    ownershipInvalidationGeneration: 1,
    scope: 'user:u1',
  }),
  isAccountMutationCurrent: () => true,
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: { updateXaiOAuthConnected: typeof mocks.connected }) => unknown) =>
    selector({ updateXaiOAuthConnected: mocks.connected }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    (selector: (state: { isUserStateInit: boolean; userStateScope: string }) => unknown) =>
      selector({ isUserStateInit: true, userStateScope: 'user:u1' }),
    { getState: () => ({}) },
  ),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: () => 'user:u1',
    hasActiveUserStateOwnerMismatch: () => false,
    isLogin: () => true,
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    xaiOAuth: {
      logout: { useMutation: () => ({ isPending: false, mutateAsync: mocks.logout }) },
      pollDeviceLogin: { useMutation: () => ({ mutateAsync: mocks.poll }) },
      startDeviceLogin: { useMutation: () => ({ isPending: false, mutateAsync: mocks.start }) },
      status: {
        useQuery: () => ({ data: { connected: false }, refetch: vi.fn() }),
      },
    },
  },
}));

vi.mock('../openai/openaiCodexStatus', () => ({
  CODEX_HELP_TOOLTIP_MAX_WIDTH: '360px',
  clampCodexUsagePercent: () => 0,
  formatCodexPlanLabel: () => undefined,
  getCoarsePointerServerSnapshot: () => false,
  getCoarsePointerSnapshot: () => false,
  resolveCodexHelpTrigger: () => ['focus'],
  resolveCodexUsageStroke: () => undefined,
  subscribeCoarsePointer: () => () => {},
}));

import XaiOAuthSignIn from './XaiOAuthSignIn';

const startedLogin = () => ({
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  handoffId: 'handoff-ui',
  intervalMs: 5_000,
  userCode: 'TEST',
  verificationUrl: 'https://auth.x.ai/device',
});

describe('XaiOAuthSignIn device login lifecycle', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mocks.start.mockReset();
    mocks.poll.mockReset();
    mocks.logout.mockReset();
    mocks.connected.mockReset();
  });

  it('does not resume device polling after Settings unmounts during a pending poll', async () => {
    vi.useFakeTimers();
    mocks.start.mockResolvedValue(startedLogin());
    let resolvePoll!: (result: { intervalMs: number; nextDelayMs: number; status: 'pending' }) => void;
    mocks.poll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    mocks.poll.mockResolvedValue({ intervalMs: 5_000, nextDelayMs: 5_000, status: 'pending' });

    const view = render(<XaiOAuthSignIn />);
    await act(async () => {
      fireEvent.click(screen.getByText('xaiOAuth.signIn'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.poll).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      resolvePoll({ intervalMs: 5_000, nextDelayMs: 5_000, status: 'pending' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.poll).toHaveBeenCalledTimes(1);
  });

  it('does not start polling if Settings unmounts during startDeviceLogin', async () => {
    vi.useFakeTimers();
    let resolveStart!: (result: ReturnType<typeof startedLogin>) => void;
    mocks.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    const view = render(<XaiOAuthSignIn />);
    await act(async () => {
      fireEvent.click(screen.getByText('xaiOAuth.signIn'));
    });
    view.unmount();
    await act(async () => {
      resolveStart(startedLogin());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it('does not retry after a rejected poll once Settings has unmounted', async () => {
    vi.useFakeTimers();
    mocks.start.mockResolvedValue(startedLogin());
    let rejectPoll!: (error: Error) => void;
    mocks.poll.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPoll = reject;
        }),
    );

    const view = render(<XaiOAuthSignIn />);
    await act(async () => {
      fireEvent.click(screen.getByText('xaiOAuth.signIn'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.poll).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      rejectPoll(new Error('network'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.poll).toHaveBeenCalledTimes(1);
  });
});
