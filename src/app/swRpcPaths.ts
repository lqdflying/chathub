/** Same-origin RPC paths that must not enter the PWA runtime cache. */
export const isRpcNetworkOnlyPath = (pathname: string): boolean =>
  pathname.startsWith('/trpc/') || pathname.startsWith('/webapi/');
