export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export const CONTENT_TYPES = [
  { label: 'application/json', value: 'application/json' },
  { label: 'text/plain', value: 'text/plain' },
  { label: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
  { label: 'application/xml', value: 'application/xml' },
];

export const COMMON_HEADER_NAMES = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Origin',
  'Pragma',
  'Range',
  'Referer',
  'User-Agent',
  'X-Api-Key',
  'X-Correlation-Id',
  'X-Csrf-Token',
  'X-Forwarded-For',
  'X-Request-Id',
  'X-Requested-With',
];

export const REQUEST_TIMEOUT_MS = 60_000;

/** Above this size Shiki highlighting becomes too slow — fall back to a plain <pre>. */
export const HIGHLIGHT_MAX_CHARS = 100_000;

/** Bound recursive conversion so large JSON responses cannot block the response panel. */
export const JSON_TREE_MAX_NODES = 2_000;
