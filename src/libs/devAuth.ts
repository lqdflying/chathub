import { secureCompareStrings } from './tokenAuth';

const DEFAULT_DEV_USER_ID = 'DEV_USER';
const DEV_API_HEADER = 'lobe-auth-dev-backend-api';
const DEV_SECRET_HEADER = 'lobe-auth-dev-secret';

export const resolveDevBypassUserId = (
  headers: Pick<Headers, 'get'>,
): string | undefined => {
  if (process.env.NODE_ENV !== 'development') return undefined;

  const expectedSecret = process.env.AUTH_DEV_BYPASS_SECRET;
  const providedSecret = headers.get(DEV_SECRET_HEADER);
  const hasValidDebugHeaders =
    headers.get(DEV_API_HEADER) === '1' &&
    !!expectedSecret &&
    !!providedSecret &&
    secureCompareStrings(providedSecret, expectedSecret);
  const hasMockUserOptIn = process.env.ENABLE_MOCK_DEV_USER === '1';

  if (!hasMockUserOptIn && !hasValidDebugHeaders) return undefined;

  return process.env.MOCK_DEV_USER_ID?.trim() || DEFAULT_DEV_USER_ID;
};
