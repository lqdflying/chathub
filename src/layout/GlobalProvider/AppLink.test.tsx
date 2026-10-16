import { fireEvent, render, screen } from '@testing-library/react';
import React, { type MouseEvent, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLink from './AppLink';

const { downloadFile, isAppleInstalledApp } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  isAppleInstalledApp: vi.fn(() => false),
}));

vi.stubGlobal('React', React);

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children?: ReactNode;
    href?: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock('@/utils/client/downloadFile', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  reportIosDownloadFailure: vi.fn(),
}));

vi.mock('@/services/file', () => ({
  fileService: { getFile: vi.fn() },
}));

vi.mock('@/utils/platform', () => ({
  isAppleInstalledApp: () => isAppleInstalledApp(),
}));

describe('AppLink', () => {
  beforeEach(() => {
    downloadFile.mockReset();
    isAppleInstalledApp.mockReset();
    isAppleInstalledApp.mockReturnValue(false);
  });

  it('saves a same-origin file link inside the installed app', () => {
    isAppleInstalledApp.mockReturnValue(true);
    const href = `${window.location.origin}/webapi/files/scope/id.docx`;
    render(<AppLink href={href}>download_test.docx</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(false);
    expect(downloadFile).toHaveBeenCalledWith(href, 'download_test.docx', false);
  });

  it('leaves an ordinary link alone', () => {
    isAppleInstalledApp.mockReturnValue(true);
    render(<AppLink href="https://example.com/docs">Docs</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(true);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('leaves a file link alone outside the installed app', () => {
    render(<AppLink href="/webapi/files/scope/id.docx">download_test.docx</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(true);
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
