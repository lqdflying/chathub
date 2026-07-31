export const APP_FILE_PROXY_PATH_PREFIX = '/webapi/files/';

// Namespaces written server-side only — image-generation assets (via FileService.uploadMedia,
// no files row) and avatars (via s3.uploadBuffer). A client upload never legitimately targets
// them, so a client-supplied key that lands here is an attempt to obtain a presigned PUT for,
// or assert `files` ownership of, another user's or the system's objects.
export const isPrivilegedStorageKey = (key: string): boolean =>
  key.startsWith('generations/') || key.startsWith('user/');

// Validate a client-supplied upload/presign target: reject privileged namespaces and
// traversal/control-char/absolute/backslash shapes before a presigned URL is minted for it.
export const isValidUploadPathname = (pathname: string): boolean =>
  pathname.length > 0 &&
  pathname.length <= 1024 &&
  !pathname.startsWith('/') &&
  !pathname.includes('\\') &&
  !isPrivilegedStorageKey(pathname) &&
  ![...pathname].some((char) => char.charCodeAt(0) <= 0x1F) &&
  !pathname.split('/').some((segment) => segment === '..' || segment === '.');

// URL.pathname keeps %2F/%5C encoded, so a decoded segment can smuggle in separators
// ('..%2f..%2fx' → '../../x') — reject them, and control chars too. Next.js decodes
// catch-all params before they reach a route handler, so the file-proxy route must
// reject the same shapes on its already-decoded segments.
export const isValidFileProxyKeySegments = (segments: string[]): boolean =>
  segments.length > 0 &&
  !segments.some(
    (s) =>
      s === '..' ||
      s === '.' ||
      s === '' ||
      s.includes('/') ||
      s.includes('\\') ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001F]/.test(s),
  );

const decodeAppFileProxyKey = (pathname: string): string | undefined => {
  if (!pathname.startsWith(APP_FILE_PROXY_PATH_PREFIX)) return undefined;

  try {
    const segments = pathname
      .slice(APP_FILE_PROXY_PATH_PREFIX.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment));

    if (!isValidFileProxyKeySegments(segments)) return undefined;

    const key = segments.join('/');
    if (key.startsWith('/')) return undefined;

    return key;
  } catch {
    return undefined;
  }
};

export const extractKeyFromAppFileProxyUrl = (
  reference: string,
  appUrl?: string,
): string | undefined => {
  const rootRelativeProxyPath = reference.startsWith(APP_FILE_PROXY_PATH_PREFIX);
  const bareProxyPath = reference.startsWith(APP_FILE_PROXY_PATH_PREFIX.slice(1));

  if (rootRelativeProxyPath || bareProxyPath) {
    const pathname = new URL(reference, 'http://app.local').pathname;
    return decodeAppFileProxyKey(pathname);
  }

  if (!appUrl) return undefined;

  try {
    const configuredAppUrl = new URL(appUrl);
    const absoluteReference = new URL(reference, configuredAppUrl);
    if (absoluteReference.host !== configuredAppUrl.host) return undefined;

    return decodeAppFileProxyKey(absoluteReference.pathname);
  } catch {
    return undefined;
  }
};
