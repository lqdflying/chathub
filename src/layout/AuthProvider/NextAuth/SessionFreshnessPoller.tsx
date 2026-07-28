'use client';

import type { Session } from 'next-auth';
import { useSession } from 'next-auth/react';
import { memo, useEffect, useRef } from 'react';

import {
  SESSION_REFRESH_HEADER,
  SESSION_REFRESH_HEADER_VALUE,
} from '@/libs/next-auth/sessionConstants';
import {
  NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT,
  NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY,
  getNextAuthSessionTransitionGeneration,
  isNextAuthSessionTransitionPending,
  runWithNextAuthSessionLock,
} from '@/libs/next-auth/sessionLifecycle';
import { API_ENDPOINTS } from '@/services/_url';

const SESSION_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

interface SessionProbeResult {
  session: Session | null;
}

interface SessionFreshnessPollerProps {
  onReconcileSession: (session: Session | null) => void;
}

const getSessionSnapshot = (result: unknown): Session | null | undefined => {
  if (!result || typeof result !== 'object' || !('session' in result)) return;

  const { session } = result as Partial<SessionProbeResult>;
  if (session === null) return null;
  if (
    !session ||
    typeof session !== 'object' ||
    !session.user ||
    typeof session.user.id !== 'string'
  ) {
    return;
  }

  return session;
};

const SessionFreshnessPoller = memo<SessionFreshnessPollerProps>(({ onReconcileSession }) => {
  const { data: session, status } = useSession();
  const activeSessionIdentity = session?.user?.id;
  const activeSessionIdentityRef = useRef(activeSessionIdentity);
  activeSessionIdentityRef.current = activeSessionIdentity;

  useEffect(() => {
    if (status === 'loading') return;

    let activeAbortController: AbortController | undefined;
    let isCurrentSessionEffect = true;
    let shouldReconcileAfterActiveRequest = false;

    const pollSession = async (refreshExpiry: boolean) => {
      if (!navigator.onLine || activeAbortController || isNextAuthSessionTransitionPending()) {
        return;
      }

      const abortController = new AbortController();
      const transitionGeneration = getNextAuthSessionTransitionGeneration();
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
        const probedSession = getSessionSnapshot(probeResult);
        if (probedSession === undefined) return;

        const probedSessionIdentity = probedSession?.user?.id;
        if (
          !isCurrentSessionEffect ||
          abortController.signal.aborted ||
          activeSessionIdentityRef.current !== activeSessionIdentity ||
          transitionGeneration !== getNextAuthSessionTransitionGeneration() ||
          isNextAuthSessionTransitionPending()
        ) {
          return;
        }

        if (probedSessionIdentity !== activeSessionIdentity) {
          onReconcileSession(probedSession);
          return;
        }
        if (!refreshExpiry || !activeSessionIdentity) return;

        await runWithNextAuthSessionLock(async () => {
          if (
            !isCurrentSessionEffect ||
            abortController.signal.aborted ||
            activeSessionIdentityRef.current !== activeSessionIdentity ||
            transitionGeneration !== getNextAuthSessionTransitionGeneration() ||
            isNextAuthSessionTransitionPending()
          ) {
            return;
          }

          const refreshResponse = await fetch(`${API_ENDPOINTS.oauth}/session`, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              [SESSION_REFRESH_HEADER]: SESSION_REFRESH_HEADER_VALUE,
            },
            signal: abortController.signal,
          });
          if (!refreshResponse.ok) return;

          const refreshedSessionResult: unknown = await refreshResponse.json();
          const refreshedSession = getSessionSnapshot({ session: refreshedSessionResult });
          if (refreshedSession === undefined) return;
          if (
            !isCurrentSessionEffect ||
            abortController.signal.aborted ||
            activeSessionIdentityRef.current !== activeSessionIdentity ||
            transitionGeneration !== getNextAuthSessionTransitionGeneration() ||
            isNextAuthSessionTransitionPending()
          ) {
            return;
          }

          if (refreshedSession?.user?.id !== activeSessionIdentity) {
            onReconcileSession(refreshedSession);
          }
        });
      } catch {
        // Preserve the last confirmed session when the freshness probe is inconclusive.
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = undefined;
        }
        if (
          shouldReconcileAfterActiveRequest &&
          isCurrentSessionEffect &&
          !isNextAuthSessionTransitionPending()
        ) {
          shouldReconcileAfterActiveRequest = false;
          void pollSession(false);
        }
      }
    };

    void pollSession(false);

    const reconcileAfterTransition = () => {
      if (activeAbortController) {
        shouldReconcileAfterActiveRequest = true;
        return;
      }

      shouldReconcileAfterActiveRequest = false;
      void pollSession(false);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY) return;

      if (event.newValue) {
        activeAbortController?.abort();
      } else {
        reconcileAfterTransition();
      }
    };
    const handleTransitionCompleted = () => {
      reconcileAfterTransition();
    };
    const interval =
      status === 'authenticated'
        ? window.setInterval(() => {
            void pollSession(true);
          }, SESSION_REFETCH_INTERVAL_MS)
        : undefined;
    window.addEventListener('storage', handleStorage);
    window.addEventListener(
      NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT,
      handleTransitionCompleted,
    );

    return () => {
      isCurrentSessionEffect = false;
      activeAbortController?.abort();
      if (interval !== undefined) window.clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(
        NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT,
        handleTransitionCompleted,
      );
    };
  }, [activeSessionIdentity, onReconcileSession, status]);

  return null;
});

SessionFreshnessPoller.displayName = 'SessionFreshnessPoller';

export default SessionFreshnessPoller;
