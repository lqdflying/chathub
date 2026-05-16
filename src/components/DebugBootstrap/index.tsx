'use client';

import debug from 'debug';
import { useEffect } from 'react';

import { getDebugConfig } from '@/envs/debug';

const CHATHUB_CLIENT_NS = 'lobe-chat:*';

/**
 * Client-side debug bootstrap.
 *
 * Adds or removes the lobe-chat:* namespace from the browser's debug list
 * based on the explicit NEXT_PUBLIC_CHATHUB_DEBUG=1 flag, while preserving
 * any user-defined namespaces that were already in localStorage.
 *
 * NOTE: CHATHUB_DEBUG=1 is server-only and does not affect browser debug.
 */
const DebugBootstrap = () => {
  useEffect(() => {
    const config = getDebugConfig();
    const enabled = config.CHATHUB_DEBUG;

    const raw = localStorage.getItem('debug') || '';
    const namespaces = raw
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const hasNs = namespaces.includes(CHATHUB_CLIENT_NS);

    if (enabled && !hasNs) {
      namespaces.push(CHATHUB_CLIENT_NS);
      debug.enable(namespaces.join(','));
    } else if (!enabled && hasNs) {
      const filtered = namespaces.filter((n) => n !== CHATHUB_CLIENT_NS);
      if (filtered.length > 0) {
        debug.enable(filtered.join(','));
      } else {
        localStorage.removeItem('debug');
        debug.disable();
      }
    }
  }, []);

  return null;
};

export default DebugBootstrap;
