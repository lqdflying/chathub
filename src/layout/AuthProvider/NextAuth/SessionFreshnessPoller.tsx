'use client';

import { useSession } from 'next-auth/react';
import { memo, useEffect, useRef } from 'react';

import { API_ENDPOINTS } from '@/services/_url';

const SESSION_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

interface SessionProbeResult {
  userId: string | null;
}

const getProbedSessionIdentity = (result: unknown): string | null | undefined => {
  if (!result || typeof result !== 'object' || !('userId' in result)) return;

  const { userId } = result as Partial<SessionProbeResult>;
  return typeof userId === 'string' || userId === null ? userId : undefined;
};

const SessionFreshnessPoller = memo(() => {
  const { data: session, status } = useSession();
  const activeSessionIdentity = session?.user?.id;
  const activeSessionIdentityRef = useRef(activeSessionIdentity);
  activeSessionIdentityRef.current = activeSessionIdentity;

  useEffect(() => {
    if (status !== 'authenticated' || !activeSessionIdentity) return;

    let activeAbortController: AbortController | undefined;
    let isCurrentSessionEffect = true;
    let isReloading = false;

    const pollSession = async () => {
      if (!navigator.onLine || activeAbortController || isReloading) return;

      const abortController = new AbortController();
      activeAbortController = abortController;
      try {
        const response = await fetch(API_ENDPOINTS.sessionProbe, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: abortController.signal,
        });
        if (!response.ok) return;

        const probeResult: unknown = await response.json();
        const probedSessionIdentity = getProbedSessionIdentity(probeResult);
        if (
          probedSessionIdentity === undefined ||
          probedSessionIdentity === activeSessionIdentity
        ) {
          return;
        }
        if (!isCurrentSessionEffect || abortController.signal.aborted) return;
        if (activeSessionIdentityRef.current !== activeSessionIdentity) return;

        isReloading = true;
        window.location.reload();
      } catch {
        // Preserve the last confirmed session when the freshness probe is inconclusive.
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = undefined;
        }
      }
    };

    const interval = window.setInterval(() => {
      void pollSession();
    }, SESSION_REFETCH_INTERVAL_MS);

    return () => {
      isCurrentSessionEffect = false;
      activeAbortController?.abort();
      window.clearInterval(interval);
    };
  }, [activeSessionIdentity, status]);

  return null;
});

SessionFreshnessPoller.displayName = 'SessionFreshnessPoller';

export default SessionFreshnessPoller;
