import { useEffect, useRef, useState } from 'react';

export const GENERATING_MARKDOWN_THROTTLE_DESKTOP_MS = 50;
export const GENERATING_MARKDOWN_THROTTLE_MOBILE_MS = 100;

/** Throttle markdown text on the generating row only. Idle rows stay immediate. */
export const useThrottledMarkdownValue = (
  value: string,
  enabled: boolean,
  intervalMs: number,
): string => {
  const [shown, setShown] = useState(value);
  const lastFlushRef = useRef(0);
  const pendingRef = useRef(value);

  useEffect(() => {
    if (!enabled) {
      setShown(value);
      return;
    }

    pendingRef.current = value;
    const elapsed = Date.now() - lastFlushRef.current;
    if (elapsed >= intervalMs) {
      lastFlushRef.current = Date.now();
      setShown(value);
      return;
    }

    const timer = window.setTimeout(() => {
      lastFlushRef.current = Date.now();
      setShown(pendingRef.current);
    }, intervalMs - elapsed);

    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs, value]);

  return enabled ? shown : value;
};
