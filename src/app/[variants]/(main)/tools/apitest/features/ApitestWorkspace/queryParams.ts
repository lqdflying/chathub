import { type QueryParamRow, createParamRow } from './types';

const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
};

/**
 * Splits a URL into { base, query, fragment } without requiring a parseable
 * URL, so partially-typed URLs still work.
 */
const splitUrl = (url: string): { base: string; fragment: string; query: string } => {
  let rest = url;
  let fragment = '';

  const hashIndex = rest.indexOf('#');
  if (hashIndex >= 0) {
    fragment = rest.slice(hashIndex);
    rest = rest.slice(0, hashIndex);
  }

  const queryIndex = rest.indexOf('?');
  if (queryIndex >= 0) {
    return { base: rest.slice(0, queryIndex), fragment, query: rest.slice(queryIndex + 1) };
  }
  return { base: rest, fragment, query: '' };
};

/**
 * Extracts the query string of a URL into editable rows. Tolerates partial or
 * invalid URLs and ignores the #fragment.
 */
export const parseQueryParams = (url: string): QueryParamRow[] => {
  const { query } = splitUrl(url);
  if (!query) return [];

  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      if (eqIndex < 0) return createParamRow(safeDecode(pair), '');
      return createParamRow(
        safeDecode(pair.slice(0, eqIndex)),
        safeDecode(pair.slice(eqIndex + 1)),
      );
    });
};

/**
 * Rebuilds a URL from its base plus the given param rows. Disabled rows and
 * rows with an empty key are omitted; the #fragment is preserved.
 */
export const buildUrlWithParams = (url: string, rows: QueryParamRow[]): string => {
  const { base, fragment } = splitUrl(url);

  const query = rows
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => `${encodeURIComponent(row.key.trim())}=${encodeURIComponent(row.value)}`)
    .join('&');

  return query ? `${base}?${query}${fragment}` : `${base}${fragment}`;
};
