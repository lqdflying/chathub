'use client';

import Link from 'next/link';
import { MouseEvent, ReactNode } from 'react';

import { downloadFile } from '@/utils/client/downloadFile';
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

export const appFileDownloadName = (href: string, children: ReactNode) => {
  const text = linkText(children).trim();
  if (text && !text.includes('/') && /\.[\dA-Za-z]+$/.test(text)) return text;

  try {
    const path = new URL(href, window.location.href).pathname;
    return decodeURIComponent(path.split('/').pop() || 'download');
  } catch {
    return 'download';
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
        if (!isAppleInstalledApp() || !isSameOriginFileUrl(href)) return;

        event.preventDefault();
        void downloadFile(href, appFileDownloadName(href, children), false);
      }}
    >
      {children}
    </Link>
  );
};

export default AppLink;
