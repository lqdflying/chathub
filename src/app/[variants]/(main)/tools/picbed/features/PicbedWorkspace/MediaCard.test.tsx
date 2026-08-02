import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import MediaCard from './MediaCard';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
  }: {
    'aria-label': string;
    'onClick': () => void;
  }) => <button aria-label={ariaLabel} onClick={onClick} />,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { success: vi.fn() } }),
  },
  Image: ({ alt, className, src }: { alt: string; className: string; src: string }) => (
    <img alt={alt} className={className} src={src} />
  ),
  Input: ({ 'aria-label': ariaLabel, value }: { 'aria-label': string; 'value': string }) => (
    <input aria-label={ariaLabel} readOnly value={value} />
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
});
