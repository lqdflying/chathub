'use client';

import debug from 'debug';
import { useEffect } from 'react';

import { getDebugConfig } from '@/envs/debug';

interface DebugBootstrapProps {
  /**
   * Passed from the server layout when CHATHUB_DEBUG=1 is set server-side.
   * This lets a single CHATHUB_DEBUG=1 switch enable both server and client
   * debug logs without requiring NEXT_PUBLIC_CHATHUB_DEBUG=1.
   */
  serverDebugEnabled?: boolean;
}

/**
 * Client-side debug bootstrap.
 *
 * Enables the lobe-chat:* debug namespace in the browser when either:
 *   - NEXT_PUBLIC_CHATHUB_DEBUG=1 (client-only env), or
 *   - serverDebugEnabled=true (prop passed from server layout when CHATHUB_DEBUG=1).
 */
const DebugBootstrap = ({ serverDebugEnabled }: DebugBootstrapProps) => {
  useEffect(() => {
    const config = getDebugConfig();
    if (config.CHATHUB_DEBUG || serverDebugEnabled) {
      debug.enable('lobe-chat:*');
    }
  }, [serverDebugEnabled]);

  return null;
};

export default DebugBootstrap;
