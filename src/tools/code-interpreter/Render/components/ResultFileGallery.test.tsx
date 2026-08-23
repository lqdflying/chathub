import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadFile, messageError, messageSuccess, writeText } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@/utils/client/downloadFile', () => ({
  downloadFile,
}));

vi.mock('@/services/file', () => ({
  fileService: { getFile: vi.fn() },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { useFetchInterpreterFileItem: () => { data: undefined } }) => unknown) =>
    selector({
      useFetchInterpreterFileItem: () => ({ data: undefined }),
    }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    onClick,
  }: {
    'aria-label': string;
    'onClick'?: () => void;
  }) => <button aria-label={ariaLabel} onClick={onClick} />,
  MaterialFileTypeIcon: () => <span>file-icon</span>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: messageError, success: messageSuccess } }),
  },
  Image: Object.assign(
    ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
    {
      PreviewGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    },
  ),
  Input: ({ 'aria-label': ariaLabel, value }: { 'aria-label': string; 'value': string }) => (
    <input aria-label={ariaLabel} readOnly value={value} />
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: string[]) => classNames.join(' '),
    styles: {
      card: 'card',
      filename: 'filename',
      footer: 'footer',
      grid: 'grid',
      media: 'media',
      placeholder: 'placeholder',
      previewImage: 'preview-image',
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

import ResultFileGallery from './ResultFileGallery';

describe('ResultFileGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a persisted image URL and downloads with downloadFile', async () => {
    render(
      <ResultFileGallery
        files={[
          {
            fileId: 'file-out',
            filename: 'plot_1.png',
            url: 'https://app.example/webapi/files/plot_1.png',
          },
        ]}
      />,
    );

    expect(screen.getByAltText('plot_1.png').getAttribute('src')).toBe(
      'https://app.example/webapi/files/plot_1.png',
    );
    expect((screen.getByLabelText('codeInterpreter.fileUrl') as HTMLInputElement).value).toBe(
      'https://app.example/webapi/files/plot_1.png',
    );

    fireEvent.click(screen.getByLabelText('codeInterpreter.download'));

    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(
        'https://app.example/webapi/files/plot_1.png',
        'plot_1.png',
      ),
    );
  });
});
