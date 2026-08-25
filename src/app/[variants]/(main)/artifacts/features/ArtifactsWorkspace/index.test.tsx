import type { ImageArtifactListResult } from '@lobechat/types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artifactService } from '@/services/artifacts';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

import ArtifactsWorkspace from './index';

const scrollIntoView = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({ matches: false })),
);

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
});

vi.mock('ahooks', () => ({ useDebounce: (value: string) => value }));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/services/artifacts', () => ({
  artifactService: { list: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    disabled,
    onClick,
  }: {
    'aria-label': string;
    'disabled'?: boolean;
    'onClick': () => void;
  }) => <button aria-label={ariaLabel} disabled={disabled} onClick={onClick} type={'button'} />,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: vi.fn(), success: vi.fn() },
      modal: {
        confirm: ({ onOk }: { onOk?: () => void | Promise<void> }) => {
          void onOk?.();
        },
      },
    }),
  },
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button aria-label={ariaLabel} onClick={onClick} type={'button'}>
      {children}
    </button>
  ),
  Checkbox: ({
    'aria-label': ariaLabel,
    checked,
  }: {
    'aria-label'?: string;
    checked?: boolean;
  }) => <input aria-label={ariaLabel} checked={!!checked} readOnly type={'checkbox'} />,
  Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  Image: Object.assign(() => null, {
    PreviewGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }),
  Input: ({
    'aria-label': ariaLabel,
    onChange,
    value,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input aria-label={ariaLabel} onChange={onChange} value={value} />
  ),
  Pagination: ({
    current,
    onChange,
    pageSize,
    total,
  }: {
    current: number;
    onChange: (page: number) => void;
    pageSize: number;
    total: number;
  }) => (
    <div data-current={current} data-page-size={pageSize} data-testid={'pagination'} data-total={total}>
      {Array.from({ length: Math.max(1, Math.ceil(total / pageSize)) }, (_, index) => (
        <button
          aria-label={`page-${index + 1}`}
          key={index}
          onClick={() => onChange(index + 1)}
          type={'button'}
        />
      ))}
    </div>
  ),
  Result: ({ subTitle }: { subTitle: React.ReactNode }) => <div>{subTitle}</div>,
  Select: ({
    'aria-label': ariaLabel,
    onChange,
    value,
  }: {
    'aria-label': string;
    'onChange': (value: string) => void;
    'value': string;
  }) => (
    <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} value={value}>
      <option value={'newest'}>newest</option>
      <option value={'oldest'}>oldest</option>
    </select>
  ),
  Skeleton: Object.assign(() => <div>loading</div>, {
    Image: () => <div>loading</div>,
  }),
  Typography: {
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: { grid: 'grid', header: 'header', pagination: 'pagination', toolbar: 'toolbar' },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
  }) => (
    <div onClick={onClick} role={onClick ? 'presentation' : undefined}>
      {children}
    </div>
  ),
}));

vi.mock('./ArtifactCard', () => ({
  default: ({ artifact }: { artifact: { name: string } }) => <div>{artifact.name}</div>,
}));

const artifact = (id: string, name: string) => ({
  createdAt: new Date('2026-08-04T00:00:00Z'),
  fileType: 'image/png',
  id,
  name,
  size: 10,
  url: `https://example.com/${id}.png`,
});

const verifyAccountOwnership = () => {
  useUserStore.setState({
    isUserStateInit: true,
    userStateOwnerId: 'account-a',
    userStateScope: 'user:account-a',
  });
};

describe('ArtifactsWorkspace', () => {
  beforeEach(() => {
    vi.mocked(artifactService.list).mockReset();
    vi.mocked(artifactService.remove).mockReset();
    vi.mocked(artifactService.remove).mockResolvedValue();
    scrollIntoView.mockReset();
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

  it('waits for verified account ownership before loading artifacts', async () => {
    vi.mocked(artifactService.list).mockResolvedValue({
      items: [artifact('image-a', 'verified-image.png')],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    render(<ArtifactsWorkspace />);

    await screen.findByText('empty');
    expect(artifactService.list).not.toHaveBeenCalled();

    act(() => verifyAccountOwnership());

    expect(await screen.findByText('verified-image.png')).toBeTruthy();
    expect(artifactService.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      q: undefined,
      sort: 'newest',
    });
    expect(screen.getByTestId('pagination').getAttribute('data-total')).toBe('1');
    expect(screen.getByTestId('pagination').getAttribute('data-page-size')).toBe('20');
  });

  it('passes search, sort, and pagination to the artifact API', async () => {
    verifyAccountOwnership();
    vi.mocked(artifactService.list).mockImplementation(async ({ page = 1 }) => ({
      items: [artifact(`image-${page}`, `page-${page}.png`)],
      page,
      pageSize: 20,
      total: 21,
    }));

    render(<ArtifactsWorkspace />);
    await screen.findByText('page-1.png');

    fireEvent.change(screen.getByLabelText('search.label'), {
      target: { value: 'city' },
    });
    fireEvent.change(screen.getByLabelText('sort.label'), {
      target: { value: 'oldest' },
    });

    await waitFor(() =>
      expect(artifactService.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        q: 'city',
        sort: 'oldest',
      }),
    );

    fireEvent.click(screen.getByLabelText('page-2'));

    await waitFor(() =>
      expect(artifactService.list).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
        q: 'city',
        sort: 'oldest',
      }),
    );
    expect(await screen.findByText('page-2.png')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('deletes the selected page and reloads the current page', async () => {
    verifyAccountOwnership();
    vi.mocked(artifactService.list).mockResolvedValue({
      items: [artifact('image-a', 'keep.png'), artifact('image-b', 'drop.png')],
      page: 1,
      pageSize: 20,
      total: 2,
    });

    render(<ArtifactsWorkspace />);
    await screen.findByText('keep.png');

    fireEvent.click(screen.getByLabelText('select.page'));
    fireEvent.click(screen.getByRole('button', { name: 'delete.action' }));

    await waitFor(() =>
      expect(artifactService.remove).toHaveBeenCalledWith(['image-a', 'image-b']),
    );
    await waitFor(() =>
      expect(artifactService.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        q: undefined,
        sort: 'newest',
      }),
    );
  });

  it('clears the current-page selection after search changes', async () => {
    verifyAccountOwnership();
    vi.mocked(artifactService.list).mockImplementation(async ({ page = 1, q }) => ({
      items: [artifact(`image-${q || 'all'}`, `${q || 'all'}.png`)],
      page,
      pageSize: 20,
      total: 1,
    }));

    render(<ArtifactsWorkspace />);
    await screen.findByText('all.png');

    fireEvent.click(screen.getByLabelText('select.page'));
    expect(screen.getByRole('button', { name: 'delete.action' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('search.label'), {
      target: { value: 'city' },
    });

    await screen.findByText('city.png');
    expect(screen.queryByRole('button', { name: 'delete.action' })).toBeNull();
  });

  it('clamps to the last remaining page after deleting the last page', async () => {
    verifyAccountOwnership();
    vi.mocked(artifactService.list).mockImplementation(async ({ page = 1 }) => ({
      items: [artifact(`image-${page}`, `page-${page}.png`)],
      page,
      pageSize: 20,
      total: 21,
    }));

    render(<ArtifactsWorkspace />);
    await screen.findByText('page-1.png');

    fireEvent.click(screen.getByLabelText('page-2'));
    await screen.findByText('page-2.png');

    fireEvent.click(screen.getByLabelText('select.page'));
    fireEvent.click(screen.getByRole('button', { name: 'delete.action' }));

    await waitFor(() => expect(artifactService.remove).toHaveBeenCalledWith(['image-2']));
    await waitFor(() =>
      expect(artifactService.list).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        q: undefined,
        sort: 'newest',
      }),
    );
  });

  it('ignores a stale page response after a filter resets pagination', async () => {
    verifyAccountOwnership();

    let resolvePageTwo: ((result: ImageArtifactListResult) => void) | undefined;
    const pageTwoResponse = new Promise<ImageArtifactListResult>((resolve) => {
      resolvePageTwo = resolve;
    });

    vi.mocked(artifactService.list).mockImplementation(async ({ page = 1, q }) => {
      if (page === 2) return pageTwoResponse;

      const name = q ? `${q}-page-${page}.png` : `page-${page}.png`;
      return {
        items: [artifact(`image-${name}`, name)],
        page,
        pageSize: 20,
        total: 21,
      } as ImageArtifactListResult;
    });

    render(<ArtifactsWorkspace />);
    await screen.findByText('page-1.png');

    fireEvent.click(screen.getByLabelText('page-2'));
    await waitFor(() =>
      expect(artifactService.list).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
        q: undefined,
        sort: 'newest',
      }),
    );

    fireEvent.change(screen.getByLabelText('search.label'), {
      target: { value: 'city' },
    });

    await screen.findByText('city-page-1.png');
    expect(
      vi
        .mocked(artifactService.list)
        .mock.calls.filter(([input]) => input.q === 'city')
        .every(([input]) => input.page === 1),
    ).toBe(true);

    await act(async () => {
      resolvePageTwo?.({
        items: [artifact('stale-page-two', 'stale-page-2.png')],
        page: 2,
        pageSize: 20,
        total: 21,
      });
    });

    expect(screen.getByText('city-page-1.png')).toBeTruthy();
    expect(screen.queryByText('stale-page-2.png')).toBeNull();
  });
});
