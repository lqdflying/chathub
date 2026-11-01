/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  data: undefined as Record<string, unknown> | null | undefined,
  isError: false,
  refresh: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  setData: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: any) => (
    <button aria-label={String(title)} onClick={onClick} type="button" />
  ),
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('antd', () => {
  const Input = ({ onChange, placeholder, value }: any) => (
    <input onChange={onChange} placeholder={placeholder} value={value} />
  );
  Input.Password = Input;
  return {
    Input,
    Progress: ({ percent }: any) => <div data-testid="progress">{percent}</div>,
    Tag: ({ children }: any) => <span>{children}</span>,
  };
});

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: {} }),
}));

vi.mock('lucide-react', () => ({ RefreshCwIcon: () => null }));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (
    selector: (state: { isUserStateInit: boolean; userStateScope: string }) => unknown,
  ) => selector({ isUserStateInit: true, userStateScope: 'user:u1' }),
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
    providerUsage: {
      deleteAdminCredential: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.remove }),
      },
      get: {
        useQuery: () => ({ data: mocks.data, isError: mocks.isError, isLoading: false }),
      },
      refresh: { useMutation: () => ({ isPending: false, mutateAsync: mocks.refresh }) },
      saveAdminCredential: { useMutation: () => ({ isPending: false, mutateAsync: mocks.save }) },
    },
    useUtils: () => ({ providerUsage: { get: { setData: mocks.setData } } }),
  },
}));

const { default: ProviderUsageCard } = await import('./index');

describe('ProviderUsageCard', () => {
  beforeEach(() => {
    mocks.data = undefined;
    mocks.isError = false;
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('renders nothing when the server has no reader for the provider', () => {
    mocks.data = null;
    const { container } = render(<ProviderUsageCard provider="deepseek" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the balance with its breakdown and the key source', () => {
    mocks.data = {
      balances: [{ currency: 'USD', granted: 1, paid: 2, total: 3 }],
      credentialSource: 'server',
      credentialType: 'apiKey',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      keyHint: '****abcd',
      provider: 'deepseek',
      status: 'ok',
    };
    render(<ProviderUsageCard provider="deepseek" />);
    expect(screen.getByText('$3.00')).toBeTruthy();
    expect(screen.getByText(/providerUsage\.sourceServer/)).toBeTruthy();
    expect(screen.getByText(/providerUsage\.balanceBreakdown/)).toBeTruthy();
  });

  it('shows 7-day tokens with the cache hit rate and savings', () => {
    mocks.data = {
      credentialType: 'admin',
      fetchedAt: '2026-11-01T03:00:00.000Z',
      provider: 'anthropic',
      status: 'ok',
      tokens: {
        cacheHitPercent: 99,
        cacheSavings: { amount: 8.93, currency: 'USD' },
        total: 5_146_804,
      },
    };
    render(<ProviderUsageCard provider="anthropic" />);
    expect(screen.getByText('providerUsage.tokensTotal:{"total":"5.1M"}')).toBeTruthy();
    expect(screen.getByText('providerUsage.cacheHitRate:{"percent":99}')).toBeTruthy();
    expect(screen.getByText('providerUsage.cacheSavings:{"amount":"$8.93"}')).toBeTruthy();
    expect(screen.queryByText('providerUsage.status.unavailable')).toBeNull();
  });

  it('labels unofficial plan windows and draws each meter', () => {
    mocks.data = {
      credentialType: 'apiKey',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      provider: 'zhipu',
      status: 'ok',
      unofficial: true,
      windows: [
        { kind: 'fiveHour', remainingPercent: 93 },
        { kind: 'monthly', label: 'MCP', remainingPercent: 96 },
      ],
    };
    render(<ProviderUsageCard provider="zhipu" />);
    expect(screen.getByText('providerUsage.unofficial')).toBeTruthy();
    expect(screen.getAllByTestId('progress').map((node) => node.textContent)).toEqual(['93', '96']);
    expect(screen.getByText('providerUsage.window.monthly · MCP')).toBeTruthy();
  });

  it('shows the reason hint for a key without a plan', () => {
    mocks.data = {
      credentialType: 'apiKey',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      provider: 'minimax',
      reason: 'notOnPlan',
      status: 'unavailable',
    };
    render(<ProviderUsageCard provider="minimax" />);
    expect(screen.getByText('providerUsage.reason.notOnPlan')).toBeTruthy();
  });

  it('saves an xAI management key with its team id and stores the fresh snapshot', async () => {
    mocks.data = {
      credentialType: 'admin',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      provider: 'xai',
      status: 'noCredential',
    };
    const next = { provider: 'xai', status: 'ok' };
    mocks.save.mockResolvedValue(next);
    render(<ProviderUsageCard provider="xai" />);

    expect(screen.queryByText('providerUsage.status.noCredential')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('providerUsage.admin.keyLabel.xai'), {
      target: { value: 'xai-mgmt-key-123' },
    });
    fireEvent.change(screen.getByPlaceholderText('providerUsage.admin.teamIdPlaceholder'), {
      target: { value: 'team-1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('providerUsage.admin.save'));
    });

    expect(mocks.save).toHaveBeenCalledWith({
      accountScope: 'user:u1',
      apiKey: 'xai-mgmt-key-123',
      provider: 'xai',
      teamId: 'team-1',
    });
    expect(mocks.setData).toHaveBeenCalledWith({ accountScope: 'user:u1', provider: 'xai' }, next);
  });

  it('shows only the hint of a saved admin key and can remove it', async () => {
    mocks.data = {
      credentialSource: 'user',
      credentialType: 'admin',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      keyHint: '****9876',
      provider: 'openai',
      spend: { amount: 12.5, currency: 'USD', since: '2026-10-01T00:00:00.000Z' },
      status: 'ok',
      storedCredential: { keyHint: '****9876' },
    };
    mocks.remove.mockResolvedValue({ provider: 'openai', status: 'noCredential' });
    render(<ProviderUsageCard provider="openai" />);

    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.queryByPlaceholderText('providerUsage.admin.keyLabel.openai')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText('providerUsage.admin.remove'));
    });
    expect(mocks.remove).toHaveBeenCalledWith({ accountScope: 'user:u1', provider: 'openai' });
  });

  it('shows the admin key form when the usage query fails', () => {
    mocks.isError = true;
    render(<ProviderUsageCard provider="openai" />);
    expect(screen.getByPlaceholderText('providerUsage.admin.keyLabel.openai')).toBeTruthy();
    expect(screen.getByText('providerUsage.status.error')).toBeTruthy();
  });

  it('does not show an admin form for an API-key provider when the query fails', () => {
    mocks.isError = true;
    render(<ProviderUsageCard provider="deepseek" />);
    expect(screen.queryByPlaceholderText('providerUsage.admin.keyLabel.deepseek')).toBeNull();
    expect(screen.getByText('providerUsage.status.error')).toBeTruthy();
  });

  it('keeps the typed xAI key when the save still needs a team id', async () => {
    mocks.data = {
      credentialType: 'admin',
      fetchedAt: '2026-10-31T00:00:00.000Z',
      provider: 'xai',
      status: 'noCredential',
    };
    mocks.save.mockResolvedValue({
      credentialType: 'admin',
      provider: 'xai',
      reason: 'teamIdRequired',
      status: 'error',
    });
    render(<ProviderUsageCard provider="xai" />);
    fireEvent.change(screen.getByPlaceholderText('providerUsage.admin.keyLabel.xai'), {
      target: { value: 'xai-mgmt-key-123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('providerUsage.admin.save'));
    });
    expect(screen.getByPlaceholderText('providerUsage.admin.keyLabel.xai')).toHaveProperty(
      'value',
      'xai-mgmt-key-123',
    );
    expect(screen.getByPlaceholderText('providerUsage.admin.teamIdPlaceholder')).toBeTruthy();
  });
});
