'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Query parameter key for the file preview modal.
 * Changed from 'files' to 'file' for better semantics.
 */
export const FILE_MODAL_QUERY_KEY = 'file';
const LEGACY_FILE_MODAL_QUERY_KEY = 'files';

/**
 * Hook to get the file modal ID from URL query parameters.
 * Uses the Next.js App Router so deep links and Back behave like normal routes.
 * Supports both ?file=[id] and legacy ?files=[id].
 */
export const useFileModalId = (): string | undefined => {
  const searchParams = useSearchParams();

  return (
    searchParams?.get(FILE_MODAL_QUERY_KEY) ??
    searchParams?.get(LEGACY_FILE_MODAL_QUERY_KEY) ??
    undefined
  );
};

/**
 * Hook to set the file modal ID in the URL query parameters.
 * Writes only the canonical `file` key and clears the legacy `files` key.
 * Uses `replace` so dismissing a directly linked modal does not add a back step.
 */
export const useSetFileModalId = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (id?: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      params.delete(FILE_MODAL_QUERY_KEY);
      params.delete(LEGACY_FILE_MODAL_QUERY_KEY);

      if (id) {
        params.set(FILE_MODAL_QUERY_KEY, id);
      }

      const queryString = params.toString();
      router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`);
    },
    [router, pathname, searchParams],
  );
};

/**
 * Standalone function to set file modal ID (for use outside hooks).
 * Kept for compatibility with consumers that already hold a router/setSearchParams pair.
 */
export const createSetFileModalId = (
  router: ReturnType<typeof useRouter>,
  pathname: string | null,
  searchParams: ReturnType<typeof useSearchParams>,
) => {
  return (id?: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');

    params.delete(FILE_MODAL_QUERY_KEY);
    params.delete(LEGACY_FILE_MODAL_QUERY_KEY);

    if (id) {
      params.set(FILE_MODAL_QUERY_KEY, id);
    }

    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ''}`);
  };
};
