'use client';

import type { Session } from 'next-auth';
import { useSession } from 'next-auth/react';
import { memo, useEffect, useRef } from 'react';

import { API_ENDPOINTS } from '@/services/_url';

const SESSION_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

const getAuthenticatedSessionIdentity = (session: unknown): string | undefined => {
  if (!session || typeof session !== 'object') return;

  const user = (session as Partial<Session>).user;
  return typeof user?.id === 'string' ? user.id : undefined;
};

const SessionFreshnessPoller = memo(() => {
  const { data: session, status, update } = useSession();
  const activeSessionIdentity = session?.user?.id;
  const activeSessionIdentityRef = useRef(activeSessionIdentity);
  activeSessionIdentityRef.current = activeSessionIdentity;

  useEffect(() => {
    if (status !== 'authenticated' || !activeSessionIdentity) return;

    let activeAbortController: AbortController | undefined;
    let isCurrentSessionEffect = true;

    const pollSession = async () => {
      if (!navigator.onLine || activeAbortController) return;

      const abortController = new AbortController();
      activeAbortController = abortController;
      try {
        const response = await fetch(`${API_ENDPOINTS.oauth}/session`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: abortController.signal,
        });
        if (!response.ok) return;

        const probedSession: unknown = await response.json();
        const probedSessionIdentity = getAuthenticatedSessionIdentity(probedSession);
        const isConfirmedSignedOut = probedSession === null;
        const isConfirmedDifferentAccount =
          !!probedSessionIdentity && probedSessionIdentity !== activeSessionIdentity;
        if (!isConfirmedSignedOut && !isConfirmedDifferentAccount) return;
        if (!isCurrentSessionEffect || abortController.signal.aborted) return;
        if (activeSessionIdentityRef.current !== activeSessionIdentity) return;

        await update();
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
  }, [activeSessionIdentity, status, update]);

  return null;
});

SessionFreshnessPoller.displayName = 'SessionFreshnessPoller';

export default SessionFreshnessPoller;
