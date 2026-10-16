'use client';

import Link from 'next/link';
import { MouseEvent, ReactNode } from 'react';

import {
  type GeneratedFileDownload,
  lookupGeneratedFileDownload,
} from '@/features/Conversation/generatedFileDownloads';
import { fileService } from '@/services/file';
import { downloadFile, reportIosDownloadFailure } from '@/utils/client/downloadFile';
import { isAppleInstalledApp } from '@/utils/platform';

export const isSameOriginFileUrl = (href: unknown): href is string => {
  if (typeof href !== 'string' || typeof window === 'undefined') return false;

  try {
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/webapi/files/');
  } catch {
    return false;
  }
};

const linkText = (children: ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (!Array.isArray(children)) return '';
  return children.map((child) => linkText(child)).join('');
};

const visibleFileName = (children: ReactNode) => {
  const text = linkText(children).trim();
  if (text && !text.includes('/') && /\.[\dA-Za-z]+$/.test(text)) return text;
  return undefined;
};

export const appFileDownloadName = (href: string, children: ReactNode) => {
  const text = visibleFileName(children);
  if (text) return text;

  try {
    const path = new URL(href, window.location.href).pathname;
    return decodeURIComponent(path.split('/').pop() || 'download');
  } catch {
    return 'download';
  }
};

const saveKnownFile = async (file: GeneratedFileDownload, children: ReactNode) => {
  const name = visibleFileName(children) ?? file.filename;
  try {
    const item = await fileService.getFile(file.fileId);
    if (!item.url) {
      reportIosDownloadFailure('fetch_failed');
      return;
    }
    await downloadFile(item.url, name, false);
  } catch {
    reportIosDownloadFailure('fetch_failed');
  }
};

interface AppLinkProps {
  children?: ReactNode;
  href?: unknown;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

const AppLink = ({ href, onClick, children, ...rest }: AppLinkProps) => {
  return (
    <Link
      {...rest}
      href={href as string}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!isAppleInstalledApp() || typeof href !== 'string') return;

        const known = lookupGeneratedFileDownload(href);
        if (!known && !isSameOriginFileUrl(href)) return;

        event.preventDefault();
        if (known) {
          void saveKnownFile(known, children);
          return;
        }
        void downloadFile(href, appFileDownloadName(href, children), false);
      }}
    >
      {children}
    </Link>
  );
};

export default AppLink;
