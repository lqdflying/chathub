import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

import Client from './Client';

vi.stubGlobal('React', React);

const proTableRequest = vi.hoisted(
  () =>
    ({ request }: { request?: () => Promise<{ data: Array<{ id: number; name: string }> }> }) => {
      const [rows, setRows] = React.useState<Array<{ id: number; name: string }>>([]);

      React.useEffect(() => {
        if (!request) return;

        void request().then((result) => setRows(result.data));
      }, [request]);

      return (
        <div data-testid="api-key-table">
          {rows.map((row) => (
            <span key={row.id}>{row.name}</span>
          ))}
        </div>
      );
    },
);

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    apiKey: {
      createApiKey: { mutate: vi.fn() },
      deleteApiKey: { mutate: vi.fn() },
      getApiKeys: { query: vi.fn() },
      updateApiKey: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@ant-design/pro-components', () => ({
  ProTable: proTableRequest,
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));

vi.mock('antd', () => ({
  Popconfirm: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: () => null,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      container: 'container',
      table: 'table',
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./features', () => ({
  ApiKeyDisplay: () => null,
  ApiKeyModal: () => null,
  EditableCell: () => null,
}));

describe('API key ownership bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUserStore.setState({
      ...initialState,
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      isUserStateInit: false,
      user: { id: 'account-a' },
      userStateOwnerId: undefined,
      userStateScope: undefined,
    });
  });

  it('defers the list request and retries when account ownership becomes verified', async () => {
    vi.mocked(lambdaClient.apiKey.getApiKeys.query).mockResolvedValue([
      { id: 1, name: 'Verified account key' },
    ] as never);

    render(<Client />);

    expect(lambdaClient.apiKey.getApiKeys.query).not.toHaveBeenCalled();

    act(() => {
      useUserStore.setState({
        isUserStateInit: true,
        userStateOwnerId: 'account-a',
        userStateScope: 'user:account-a',
      });
    });

    await waitFor(() => {
      expect(lambdaClient.apiKey.getApiKeys.query).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Verified account key')).not.toBeNull();
  });
});
