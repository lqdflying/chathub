'use client';

import debug from 'debug';
import { useEffect } from 'react';

import { getDebugConfig } from '@/envs/debug';

/**
 * Client-side debug bootstrap.
 *
 * When NEXT_PUBLIC_CHATHUB_DEBUG=1, enables the lobe-chat:* debug namespace
 * in the browser so that store-level debug logs (group chat, supervisor, etc.)
 * are visible in the dev-tools console.
 */
const DebugBootstrap = () => {
  useEffect(() => {
    const config = getDebugConfig();
    if (config.CHATHUB_DEBUG) {
      debug.enable('lobe-chat:*');
    }
  }, []);

  return null;
};

export default DebugBootstrap;
