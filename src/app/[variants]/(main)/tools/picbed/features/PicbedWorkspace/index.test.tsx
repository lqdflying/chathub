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

vi.stubGlobal('React', React);

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
  Pagination: () => null,
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
      title: 'title',
    },
  }),
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
    uploadFiles: vi.fn(),
    uploading: false,
  }),
}));

describe('Picbed ownership bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(picbedService.delete).mockReset();
    vi.mocked(picbedService.list).mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
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
});
