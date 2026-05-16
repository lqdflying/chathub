/**
 * Server-side debug configuration.
 * Not prefixed with NEXT_PUBLIC — not exposed to the browser bundle.
 */
export const getServerDebugConfig = () => ({
  CHATHUB_DEBUG: process.env.CHATHUB_DEBUG === '1',
  LOG_LEVEL: process.env.LOG_LEVEL,
  DEBUG: process.env.DEBUG || '',
});
