'use client';

import { useEffect, useState } from 'react';

import { LIGHT_SCROLL_ACTIVATE_MS } from './scrollViewport';

/**
 * True only after `isScrolling` stays true for `delayMs`.
 * False as soon as scrolling stops — do not lag the exit.
 */
export const useSustainedScrolling = (
  isScrolling: boolean,
  delayMs: number = LIGHT_SCROLL_ACTIVATE_MS,
): boolean => {
  const [sustained, setSustained] = useState(false);

  useEffect(() => {
    if (!isScrolling) {
      setSustained(false);
      return;
    }

    const timer = window.setTimeout(() => setSustained(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, isScrolling]);

  return sustained;
};
