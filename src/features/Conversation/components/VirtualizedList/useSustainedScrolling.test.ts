import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIGHT_SCROLL_ACTIVATE_MS } from './scrollViewport';
import { useSustainedScrolling } from './useSustainedScrolling';

describe('useSustainedScrolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores a hover-length isScrolling blip', () => {
    const { rerender, result } = renderHook(({ scrolling }) => useSustainedScrolling(scrolling), {
      initialProps: { scrolling: false },
    });

    rerender({ scrolling: true });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LIGHT_SCROLL_ACTIVATE_MS - 1);
    });
    expect(result.current).toBe(false);

    rerender({ scrolling: false });
    act(() => {
      vi.advanceTimersByTime(LIGHT_SCROLL_ACTIVATE_MS);
    });
    expect(result.current).toBe(false);
  });

  it('turns on after a sustained scroll and off immediately', () => {
    const { rerender, result } = renderHook(({ scrolling }) => useSustainedScrolling(scrolling), {
      initialProps: { scrolling: false },
    });

    rerender({ scrolling: true });
    act(() => {
      vi.advanceTimersByTime(LIGHT_SCROLL_ACTIVATE_MS);
    });
    expect(result.current).toBe(true);

    rerender({ scrolling: false });
    expect(result.current).toBe(false);
  });
});
