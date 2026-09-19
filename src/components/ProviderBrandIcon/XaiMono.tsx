'use client';

import React, { CSSProperties, memo } from 'react';

export interface XaiMonoProps {
  className?: string;
  size?: number;
  style?: CSSProperties;
}

/**
 * Inline xAI X mark so `currentColor` follows the theme.
 * Do not load the public SVG through `<img>` / Avatar — that freezes fill to black.
 */
export const XaiMono = memo<XaiMonoProps>(({ className, size = 24, style }) => (
  <svg
    className={className}
    fill={'currentColor'}
    height={size}
    style={{ flex: 'none', lineHeight: 1, ...style }}
    viewBox={'0 0 24 24'}
    width={size}
    xmlns={'http://www.w3.org/2000/svg'}
  >
    <title>xAI</title>
    <path d="M3.2 3.2 10.4 12 3.2 20.8h4.1L12 14.7l4.7 6.1h4.1L13.6 12l7.2-8.8h-4.1L12 9.3 7.3 3.2H3.2z" />
  </svg>
));

XaiMono.displayName = 'XaiMono';
