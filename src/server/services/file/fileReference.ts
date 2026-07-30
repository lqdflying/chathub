export const APP_FILE_PROXY_PATH_PREFIX = '/webapi/files/';

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
