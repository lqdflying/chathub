import { isLocalOrPrivateUrl } from '@lobechat/utils';

export const normalizeAuthRedirect = (url: string | undefined, fallback: string) => {
  if (!url) return fallback;

  if (typeof window === 'undefined') return fallback;

  try {
    const parsedUrl = new URL(url, window.location.origin);
    const normalizedPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;

    if (parsedUrl.origin === window.location.origin) return normalizedPath;

    // Auth.js can return absolute local URLs like 0.0.0.0 or localhost while the
    // browser origin is a different local address. Strip the host and keep the path.
    if (
      isLocalOrPrivateUrl(window.location.origin) &&
      isLocalOrPrivateUrl(parsedUrl.origin)
    ) {
      return normalizedPath;
    }

    return fallback;
  } catch {
    return fallback;
  }
};