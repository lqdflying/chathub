'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { FilesTabs } from '@/types/files';

// Query params that are tied to a specific detail/workspace surface and must
// not be carried onto the home workspace when switching categories.
const DETAIL_ONLY_PARAMS = ['file', 'files'] as const;

/**
 * Hook to manage file category filter in the URL query string.
 *
 * Uses the Next.js App Router so browser Back follows real Knowledge history.
 * Selecting a category pushes a new history entry (Back returns to the previous
 * category).
 *
 * Categories are a home-workspace concept: the two `FileMenu` surfaces are the
 * desktop home panel (already on `/knowledge`) and the mobile shell drawer
 * (reachable from `/knowledge/bases/:id`). Always navigate to `/knowledge` so a
 * category tap from a base-detail route visibly switches the filtered list
 * instead of silently rewriting the detail URL.
 */
export const useFileCategory = (): [string, (value: string) => void] => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const category = searchParams?.get('category') ?? FilesTabs.All;

  const setCategory = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      for (const key of DETAIL_ONLY_PARAMS) params.delete(key);

      if (value === FilesTabs.All) {
        params.delete('category');
      } else {
        params.set('category', value);
      }

      const queryString = params.toString();
      router.push(`/knowledge${queryString ? `?${queryString}` : ''}`);
    },
    [router, searchParams],
  );

  return [category, setCategory];
};
