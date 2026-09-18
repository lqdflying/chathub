import { useEffect, useState } from 'react';

/**
 * First render returns `value` immediately so mount-time reads stay correct.
 * Later changes lag by `delayMs` (cancelled on each new value).
 */
export const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(value, debounced)) return;

    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [debounced, delayMs, value]);

  return debounced;
};
