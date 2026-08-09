'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { FilesTabs } from '@/types/files';

/**
 * Hook to manage file category filter in the URL query string.
 * Uses the Next.js App Router so browser Back follows real Knowledge history.
 * Selecting a category pushes a new history entry (Back returns to the previous category).
 */
export const useFileCategory = (): [string, (value: string) => void] => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const category = searchParams?.get('category') ?? FilesTabs.All;

  const setCategory = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      if (value === FilesTabs.All) {
        params.delete('category');
      } else {
        params.set('category', value);
      }

      const queryString = params.toString();
      router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
    },
    [router, pathname, searchParams],
  );

  return [category, setCategory];
};
