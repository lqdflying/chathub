import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useThrottledMarkdownValue } from './useThrottledMarkdownValue';

describe('useThrottledMarkdownValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes idle content through immediately', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledMarkdownValue(value, false, 50),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('ab');
  });

  it('holds generating updates until the interval elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledMarkdownValue(value, true, 50),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current).toBe('ab');
  });
});
