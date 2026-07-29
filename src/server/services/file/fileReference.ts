export const APP_FILE_PROXY_PATH_PREFIX = '/webapi/files/';

export const extractKeyFromAppFileProxyUrl = (reference: string): string | undefined => {
  let pathname: string;

  try {
    pathname = new URL(reference, 'http://app.local').pathname;
  } catch {
    return undefined;
  }

  const proxyPathIndex = pathname.indexOf(APP_FILE_PROXY_PATH_PREFIX);
  if (proxyPathIndex === -1) return undefined;

  const encodedKey = pathname.slice(proxyPathIndex + APP_FILE_PROXY_PATH_PREFIX.length);

  try {
    return encodedKey
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return undefined;
  }
};
