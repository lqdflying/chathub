/**
 * Handle legacy bug where full URLs were stored instead of keys
 * Some historical data stored complete URLs in database instead of just keys
 * Related issue: https://github.com/lobehub/lobe-chat/issues/8994
 */
export function extractKeyFromUrlOrReturnOriginal(
  url: string,
  getKeyFromFullUrl: (url: string) => string,
): string {
  // Only process URLs that start with http:// or https://
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Extract key from full URL for legacy data compatibility
    return getKeyFromFullUrl(url);
  }
  // Return original input if it's already a key
  return url;
}

/**
 * Pathname of a stored HTTP(S) URL, without a leading slash. Used as the
 * default `getKeyFromFullUrl` for env-independent canonicalization; S3
 * deletion still re-normalizes with bucket-aware `getKeyFromFullUrl`.
 */
export const pathnameKeyFromUrl = (url: string): string => {
  try {
    const { pathname } = new URL(url);
    return pathname.startsWith('/') ? pathname.slice(1) : pathname;
  } catch {
    return url;
  }
};

/**
 * App object-key prefixes stored in `files.url` / generation assets. A
 * historical row may keep the full storage URL, including a path-style bucket
 * segment (`https://s3.example.com/bucket/generations/...`). Matching these
 * prefixes recovers the same key `findUrlCandidatesByKey` uses.
 */
const APP_OBJECT_KEY_PREFIXES = ['generations/', 'files/', 'covers/'] as const;

/**
 * Compare and clean stored object references independently of URL scheme.
 * Bare keys pass through. Legacy full storage URLs from issue 8994 become the
 * object key; provider CDN URLs without an app prefix stay as their pathname
 * and are not treated as ChatHub storage keys by callers that already skip
 * `asset.originalUrl`.
 */
export const canonicalStorageKey = (value: string): string => {
  if (!value) return value;

  const extracted = extractKeyFromUrlOrReturnOriginal(value, pathnameKeyFromUrl);
  for (const prefix of APP_OBJECT_KEY_PREFIXES) {
    const index = extracted.indexOf(prefix);
    if (index >= 0) return extracted.slice(index);
  }

  return extracted;
};
