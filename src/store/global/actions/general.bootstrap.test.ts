import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/libs/swr', async () => {
  const React = await import('react');

  return {
    useOnlyFetchOnceSWR: (
      key: unknown,
      fetcher: () => unknown,
      options: { onSuccess?: (data: unknown) => void },
    ) => {
      const [data, setData] = React.useState<unknown>();
      const [error, setError] = React.useState<unknown>();

      React.useEffect(() => {
        if (!key) return;

        try {
          const fetchedData = fetcher();
          setData(fetchedData);
          options.onSuccess?.(fetchedData);
        } catch (fetchError) {
          setError(fetchError);
        }
      }, [key]);

      return { data, error };
    },
  };
});

describe('system status bootstrap', () => {
  beforeEach(() => {
    useGlobalStore.setState(initialState);
  });

  it('settles with defaults when browser storage cannot be read', async () => {
    vi.spyOn(useGlobalStore.getState().statusStorage, 'getFromLocalStorage').mockImplementation(
      () => {
        throw new SyntaxError('Unexpected token');
      },
    );

    const { result } = renderHook(() => useGlobalStore().useInitSystemStatus());

    await waitFor(() => {
      expect(result.current.error).toBeUndefined();
      expect(useGlobalStore.getState().isStatusInit).toBe(true);
    });

    expect(result.current.data).toEqual({});
    expect(useGlobalStore.getState().status).toEqual(initialState.status);
  });

  it('hydrates readable browser status normally', async () => {
    vi.spyOn(useGlobalStore.getState().statusStorage, 'getFromLocalStorage').mockReturnValue({
      noWideScreen: false,
    });

    const { result } = renderHook(() => useGlobalStore().useInitSystemStatus());

    await act(async () => {
      await waitFor(() => expect(result.current.data).toEqual({ noWideScreen: false }));
    });

    expect(useGlobalStore.getState().isStatusInit).toBe(true);
    expect(useGlobalStore.getState().status.noWideScreen).toBe(false);
  });
});
