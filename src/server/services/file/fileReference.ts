export const APP_FILE_PROXY_PATH_PREFIX = '/webapi/files/';

const decodeAppFileProxyKey = (pathname: string): string | undefined => {
  if (!pathname.startsWith(APP_FILE_PROXY_PATH_PREFIX)) return undefined;

  try {
    return pathname
      .slice(APP_FILE_PROXY_PATH_PREFIX.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
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
    if (absoluteReference.origin !== configuredAppUrl.origin) return undefined;

    return decodeAppFileProxyKey(absoluteReference.pathname);
  } catch {
    return undefined;
  }
};
