'use client';

import debug from 'debug';
import { useEffect } from 'react';

import { getDebugConfig } from '@/envs/debug';

const CHATHUB_CLIENT_NS = 'lobe-chat:*';

interface DebugBootstrapProps {
  /**
   * Passed from the server layout when CHATHUB_DEBUG=1 is set server-side.
   * Currently unused for client debug namespaces because the existing
   * lobe-chat:* logs contain prompt-adjacent data (instructions, agent
   * config, supervisor decisions) and are only enabled by the explicit
   * client-side flag NEXT_PUBLIC_CHATHUB_DEBUG=1.
   */
  serverDebugEnabled?: boolean;
}

/**
 * Client-side debug bootstrap.
 *
 * Adds or removes the lobe-chat:* namespace from the browser's debug list
 * based on the explicit NEXT_PUBLIC_CHATHUB_DEBUG=1 flag, while preserving
 * any user-defined namespaces that were already in localStorage.
 *
 * NOTE: CHATHUB_DEBUG=1 does NOT auto-enable client-side lobe-chat:*
 * because those logs contain user/agent prompt-adjacent data.
 */
const DebugBootstrap = ({ serverDebugEnabled }: DebugBootstrapProps) => {
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
  }, [serverDebugEnabled]);

  return null;
};

export default DebugBootstrap;
