import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current value on the first render', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300));

    expect(result.current).toBe('hello');
  });

  it('lags later changes until the delay elapses', () => {
    const { rerender, result } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: '' },
    });

    rerender({ value: 'h' });
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('h');
  });
});
