import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { picbedService } from '@/services/picbed';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

import PicbedWorkspace from './index';

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
    useApp: () => ({ message: { success: vi.fn() } }),
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
  default: ({ fileType, name }: { fileType: string; name: string }) => (
    <div data-file-type={fileType}>{name}</div>
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
});
