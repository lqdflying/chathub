import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { picbedService } from '@/services/picbed';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

import PicbedWorkspace from './index';

const { messageError, messageSuccess } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}));
const responsiveState = vi.hoisted(() => ({ isMobile: false, prefersReducedMotion: false }));
const scrollIntoView = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: responsiveState.prefersReducedMotion && query.includes('prefers-reduced-motion'),
  })),
);

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
});

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/services/picbed', () => ({
  picbedService: {
    delete: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    disabled,
    onClick,
    title,
  }: {
    'aria-label': string;
    'disabled'?: boolean;
    'onClick': () => void;
    'title': string;
  }) => <button aria-label={ariaLabel} disabled={disabled} onClick={onClick} title={title} />,
  Icon: () => null,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: messageError, success: messageSuccess } }),
  },
  Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  Image: Object.assign(() => null, {
    PreviewGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }),
  Pagination: ({
    current,
    onChange,
    pageSize,
    showQuickJumper,
    simple,
    total,
  }: {
    current: number;
    onChange: (page: number) => void;
    pageSize: number;
    showQuickJumper?: boolean;
    simple?: boolean;
    total: number;
  }) => (
    <div
      data-current={String(current)}
      data-quick-jumper={String(Boolean(showQuickJumper))}
      data-simple={String(Boolean(simple))}
      data-testid={'pagination'}
    >
      {Array.from({ length: Math.ceil(total / pageSize) }, (_, index) => {
        const targetPage = index + 1;

        return (
          <button
            aria-label={`pagination-page-${targetPage}`}
            key={targetPage}
            onClick={() => onChange(targetPage)}
          />
        );
      })}
    </div>
  ),
  Spin: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  },
  Upload: {
    Dragger: ({
      accept,
      children,
      multiple,
    }: {
      accept: string;
      children: React.ReactNode;
      multiple: boolean;
    }) => (
      <div data-accept={accept} data-multiple={String(multiple)} data-testid={'picbed-upload'}>
        {children}
      </div>
    ),
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: {
      dropZone: 'drop-zone',
      grid: 'grid',
      pagination: 'pagination',
      paginationBar: 'pagination-bar',
      title: 'title',
    },
  }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => responsiveState.isMobile,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./MediaCard', () => ({
  default: ({
    fileType,
    id,
    name,
    onDelete,
  }: {
    fileType: string;
    id: string;
    name: string;
    onDelete: (id: string) => Promise<void>;
  }) => (
    <div data-file-type={fileType}>
      {name}
      <button aria-label={`delete-${id}`} onClick={() => void onDelete(id)} />
    </div>
  ),
}));

vi.mock('./usePicbedUpload', () => ({
  usePicbedUpload: () => ({
    isDragging: false,
    stopDragging: vi.fn(),
    uploadFiles: vi.fn(),
    uploading: false,
  }),
}));

const createMedia = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const itemNumber = index + 1;

    return {
      createdAt: new Date(),
      fileType: 'image/png',
      id: `media-${itemNumber}`,
      name: `media-${itemNumber}.png`,
      size: 10,
      url: `https://example.com/media-${itemNumber}.png`,
    };
  });

const verifyAccountOwnership = () => {
  useUserStore.setState({
    isUserStateInit: true,
    userStateOwnerId: 'account-a',
    userStateScope: 'user:account-a',
  });
};

describe('Picbed ownership bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(picbedService.delete).mockReset();
    vi.mocked(picbedService.list).mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    responsiveState.isMobile = false;
    responsiveState.prefersReducedMotion = false;
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

  it('defers the list request and retries when account ownership becomes verified', async () => {
    vi.mocked(picbedService.list).mockResolvedValue([
      {
        createdAt: new Date(),
        fileType: 'image/png',
        id: 'image-id',
        name: 'verified-account-image.png',
        size: 10,
        url: 'https://example.com/verified-account-image.png',
      },
    ]);

    render(<PicbedWorkspace />);

    const upload = screen.getByTestId('picbed-upload');
    expect(upload.getAttribute('data-accept')).toBe('image/*,video/*');
    expect(upload.getAttribute('data-multiple')).toBe('true');

    await waitFor(() => {
      expect(screen.getByText('picbed.empty')).not.toBeNull();
    });
    expect(picbedService.list).not.toHaveBeenCalled();

    act(() => {
      useUserStore.setState({
        isUserStateInit: true,
        userStateOwnerId: 'account-a',
        userStateScope: 'user:account-a',
      });
    });

    await waitFor(() => {
      expect(picbedService.list).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('verified-account-image.png').getAttribute('data-file-type')).toBe(
      'image/png',
    );
  });

  it('removes deleted media and reports completion', async () => {
    vi.mocked(picbedService.list).mockResolvedValue([
      {
        createdAt: new Date(),
        fileType: 'image/png',
        id: 'image-id',
        name: 'deletable-image.png',
        size: 10,
        url: 'https://example.com/deletable-image.png',
      },
    ]);
    vi.mocked(picbedService.delete).mockResolvedValue({} as never);
    useUserStore.setState({
      isUserStateInit: true,
      userStateOwnerId: 'account-a',
      userStateScope: 'user:account-a',
    });

    render(<PicbedWorkspace />);
    await screen.findByText('deletable-image.png');

    fireEvent.click(screen.getByLabelText('delete-image-id'));

    await waitFor(() => expect(picbedService.delete).toHaveBeenCalledWith('image-id'));
    await waitFor(() => expect(screen.queryByText('deletable-image.png')).toBeNull());
    expect(messageSuccess).toHaveBeenCalledWith('picbed.deleted');
    expect(messageError).not.toHaveBeenCalled();
  });

  it('keeps media and reports a deletion failure', async () => {
    vi.mocked(picbedService.list).mockResolvedValue([
      {
        createdAt: new Date(),
        fileType: 'image/png',
        id: 'image-id',
        name: 'retained-image.png',
        size: 10,
        url: 'https://example.com/retained-image.png',
      },
    ]);
    vi.mocked(picbedService.delete).mockRejectedValue(new Error('Delete failed'));
    useUserStore.setState({
      isUserStateInit: true,
      userStateOwnerId: 'account-a',
      userStateScope: 'user:account-a',
    });

    render(<PicbedWorkspace />);
    await screen.findByText('retained-image.png');

    fireEvent.click(screen.getByLabelText('delete-image-id'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('picbed.deleteFailed'));
    expect(screen.getByText('retained-image.png')).not.toBeNull();
    expect(messageSuccess).not.toHaveBeenCalled();
  });

  it('supports numbered, direct, first, and last page navigation on desktop', async () => {
    vi.mocked(picbedService.list).mockResolvedValue(createMedia(45));
    verifyAccountOwnership();

    render(<PicbedWorkspace />);
    await screen.findByText('media-1.png');

    const pagination = screen.getByTestId('pagination');
    expect(pagination.getAttribute('data-current')).toBe('1');
    expect(pagination.getAttribute('data-quick-jumper')).toBe('true');
    expect(pagination.getAttribute('data-simple')).toBe('false');
    expect((screen.getByLabelText('picbed.firstPage') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('picbed.lastPage') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('pagination-page-2'));

    expect(await screen.findByText('media-21.png')).toBeTruthy();
    expect(screen.queryByText('media-1.png')).toBeNull();
    expect(screen.getByTestId('pagination').getAttribute('data-current')).toBe('2');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });

    fireEvent.click(screen.getByLabelText('picbed.lastPage'));

    expect(await screen.findByText('media-41.png')).toBeTruthy();
    expect((screen.getByLabelText('picbed.lastPage') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('picbed.firstPage'));

    expect(await screen.findByText('media-1.png')).toBeTruthy();
    expect((screen.getByLabelText('picbed.firstPage') as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses compact direct-page navigation and reduced motion on mobile', async () => {
    responsiveState.isMobile = true;
    responsiveState.prefersReducedMotion = true;
    vi.mocked(picbedService.list).mockResolvedValue(createMedia(45));
    verifyAccountOwnership();

    render(<PicbedWorkspace />);
    await screen.findByText('media-1.png');

    const pagination = screen.getByTestId('pagination');
    expect(pagination.getAttribute('data-quick-jumper')).toBe('false');
    expect(pagination.getAttribute('data-simple')).toBe('true');

    fireEvent.click(screen.getByLabelText('pagination-page-3'));

    expect(await screen.findByText('media-41.png')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('clamps to the preceding page when deletion removes the last page', async () => {
    vi.mocked(picbedService.list).mockResolvedValue(createMedia(21));
    vi.mocked(picbedService.delete).mockResolvedValue({} as never);
    verifyAccountOwnership();

    render(<PicbedWorkspace />);
    await screen.findByText('media-1.png');

    fireEvent.click(screen.getByLabelText('picbed.lastPage'));
    await screen.findByText('media-21.png');
    fireEvent.click(screen.getByLabelText('delete-media-21'));

    await waitFor(() => expect(screen.queryByText('media-21.png')).toBeNull());
    expect(await screen.findByText('media-1.png')).toBeTruthy();
    expect(screen.queryByTestId('pagination')).toBeNull();
  });
});
