import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MediaCard from './MediaCard';

const { messageError, messageSuccess, writeText } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
  }: {
    'aria-label': string;
    'onClick'?: () => void;
  }) => <button aria-label={ariaLabel} onClick={onClick} />,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: messageError, success: messageSuccess } }),
  },
  Image: ({ alt, className, src }: { alt: string; className: string; src: string }) => (
    <img alt={alt} className={className} src={src} />
  ),
  Input: ({ 'aria-label': ariaLabel, value }: { 'aria-label': string; 'value': string }) => (
    <input aria-label={ariaLabel} readOnly value={value} />
  ),
  Popconfirm: ({
    children,
    onConfirm,
    title,
  }: {
    children: React.ReactNode;
    onConfirm: () => void;
    title: React.ReactNode;
  }) => (
    <div>
      {children}
      <span>{title}</span>
      <button aria-label={'confirm-delete'} onClick={onConfirm} />
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: string[]) => classNames.join(' '),
    styles: {
      card: 'card',
      footer: 'footer',
      media: 'media',
      previewImage: 'preview-image',
      timestamp: 'timestamp',
      urlInput: 'url-input',
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const baseProps = {
  createdAt: new Date('2026-08-02T00:00:00Z'),
  id: 'media-id',
  name: 'media',
  onDelete: vi.fn(),
  url: 'https://example.com/media',
};

describe('MediaCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('React', React);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders videos with native, inline, non-autoplaying controls', () => {
    render(
      <MediaCard
        {...baseProps}
        fileType={'video/mp4'}
        name={'clip.mp4'}
        url={'https://example.com/clip.mp4'}
      />,
    );

    const video = screen.getByLabelText('clip.mp4') as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.preload).toBe('metadata');
    expect(video.getAttribute('src')).toBe('https://example.com/clip.mp4');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps images in the preview renderer', () => {
    render(
      <MediaCard
        {...baseProps}
        fileType={'image/png'}
        name={'still.png'}
        url={'https://example.com/still.png'}
      />,
    );

    expect(screen.getByAltText('still.png').getAttribute('src')).toBe(
      'https://example.com/still.png',
    );
    expect(document.querySelector('video')).toBeNull();
  });

  it('deletes a media record only after confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<MediaCard {...baseProps} fileType={'image/png'} onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText('picbed.delete'));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('confirm-delete'));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('media-id'));
  });

  it('reports clipboard failures without leaving an unhandled rejection', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    render(<MediaCard {...baseProps} fileType={'image/png'} />);

    fireEvent.click(screen.getByLabelText('picbed.copy'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('picbed.copyFailed'));
    expect(messageSuccess).not.toHaveBeenCalled();
  });

  it('clears the copy reset timer when unmounted', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<MediaCard {...baseProps} fileType={'image/png'} />);

    fireEvent.click(screen.getByLabelText('picbed.copy'));
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('picbed.copied'));
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
