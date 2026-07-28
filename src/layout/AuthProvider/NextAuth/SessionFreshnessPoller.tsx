'use client';

import { signOut, useSession } from 'next-auth/react';
import { memo, useEffect, useRef } from 'react';

import { API_ENDPOINTS } from '@/services/_url';

const SESSION_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

const SessionFreshnessPoller = memo(() => {
  const { status } = useSession();
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const pollSession = async () => {
      if (!navigator.onLine || isPollingRef.current) return;

      isPollingRef.current = true;
      try {
        const response = await fetch(`${API_ENDPOINTS.oauth}/session`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;

        const session = await response.json();
        if (session !== null) return;

        await signOut({ redirect: false });
      } catch {
        // Preserve the last confirmed session when the freshness probe is inconclusive.
      } finally {
        isPollingRef.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void pollSession();
    }, SESSION_REFETCH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [status]);

  return null;
});

SessionFreshnessPoller.displayName = 'SessionFreshnessPoller';

export default SessionFreshnessPoller;
