import { parseToolsDebugLevel } from '@/libs/logger/bootstrap';

/**
 * Server-side debug configuration.
 * Not prefixed with NEXT_PUBLIC — not exposed to the browser bundle.
 */
export const getServerDebugConfig = () => ({
  CHATHUB_DEBUG: process.env.CHATHUB_DEBUG === '1',
  CHATHUB_TOOLS_DEBUG: process.env.CHATHUB_TOOLS_DEBUG || '',
  CHATHUB_TOOLS_DEBUG_LEVEL: parseToolsDebugLevel(process.env.CHATHUB_TOOLS_DEBUG),
  DEBUG: process.env.DEBUG || '',
  LOG_LEVEL: process.env.LOG_LEVEL,
});
