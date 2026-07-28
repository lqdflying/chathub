'use client';

import { throttle, useQueryState } from 'nuqs';
import { parseAsString } from 'nuqs/server';
import { memo, useCallback, useEffect, useRef } from 'react';

import { INBOX_SESSION_ID } from '@/const/session';
import { hasVerifiedAccountOwnership } from '@/store/accountMutation';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { getSessionStoreState, useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { getUserStoreState, useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const SessionHydration = memo(() => {
  const [internalUpdateActiveId, switchTopic] = useChatStore((s) => [
    s.internal_updateActiveId,
    s.switchTopic,
  ]);
  const currentUserScope = useUserStore(authSelectors.currentUserScope);
  const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);
  const isOwnershipVerified = useUserStore((state) => {
    const scope = authSelectors.currentUserScope(state);
    return !!scope && hasVerifiedAccountOwnership(state, scope);
  });
  const isSessionListInit = useSessionStore(sessionSelectors.isSessionListInit);
  const sessions = useSessionStore((state) => state.sessions);
  const blockedSessionIdRef = useRef<string>();
  const pendingInboxNormalizationRef = useRef<string>();
  const previousVerifiedScopeRef = useRef<string>();

  const [session, setSession] = useQueryState(
    'session',
    parseAsString.withDefault(INBOX_SESSION_ID).withOptions({
      history: 'replace',
      limitUrlUpdates: throttle(50),
    }),
  );
  const querySessionRef = useRef(session);
  querySessionRef.current = session;

  const normalizeQueryToInbox = useCallback(
    (staleSessionId: string) => {
      if (staleSessionId === INBOX_SESSION_ID) return;
      if (pendingInboxNormalizationRef.current === staleSessionId) return;

      pendingInboxNormalizationRef.current = staleSessionId;
      void setSession(INBOX_SESSION_ID);
    },
    [setSession],
  );

  const activateSession = useCallback(
    (sessionId: string): boolean => {
      const sessionState = getSessionStoreState();
      if (sessionState.activeId !== sessionId) {
        sessionState.switchSession(sessionId);
        return true;
      }

      useAgentStore.setState({ activeId: sessionId });
      internalUpdateActiveId(sessionId);
      return false;
    },
    [internalUpdateActiveId],
  );

  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe(
      (state) => state.activeId,
      (requestedSessionId) => {
        if (requestedSessionId === INBOX_SESSION_ID) {
          if (querySessionRef.current !== INBOX_SESSION_ID) {
            blockedSessionIdRef.current = querySessionRef.current;
          }

          useAgentStore.setState({ activeId: requestedSessionId });
          internalUpdateActiveId(requestedSessionId);
          void switchTopic(undefined, true);
          normalizeQueryToInbox(querySessionRef.current);
          return;
        }

        const userState = getUserStoreState();
        const activeScope = authSelectors.currentUserScope(userState);
        const sessionState = getSessionStoreState();
        const isVerifiedCurrentAccount =
          !!activeScope && hasVerifiedAccountOwnership(userState, activeScope);

        if (!isVerifiedCurrentAccount || !sessionSelectors.isSessionListInit(sessionState)) return;

        if (!sessionSelectors.getSessionById(requestedSessionId)(sessionState)) {
          sessionState.switchSession(INBOX_SESSION_ID);
          return;
        }

        useAgentStore.setState({ activeId: requestedSessionId });
        internalUpdateActiveId(requestedSessionId);
        void switchTopic(undefined, true);
        if (querySessionRef.current !== requestedSessionId) {
          void setSession(requestedSessionId);
        }
      },
    );

    return unsubscribe;
  }, [internalUpdateActiveId, normalizeQueryToInbox, setSession, switchTopic]);

  useEffect(() => {
    const previousVerifiedScope = previousVerifiedScopeRef.current;
    if (currentUserScope && isOwnershipVerified) {
      previousVerifiedScopeRef.current = currentUserScope;
    }

    if (session === INBOX_SESSION_ID) {
      blockedSessionIdRef.current = undefined;
      pendingInboxNormalizationRef.current = undefined;
      activateSession(INBOX_SESSION_ID);
      return;
    }

    if (blockedSessionIdRef.current === session) {
      normalizeQueryToInbox(session);
      return;
    }

    if (hasOwnerMismatch) {
      blockedSessionIdRef.current = session;
      const didSwitchSession = activateSession(INBOX_SESSION_ID);
      if (!didSwitchSession) normalizeQueryToInbox(session);
      return;
    }

    if (!currentUserScope || !isOwnershipVerified) return;

    if (previousVerifiedScope && previousVerifiedScope !== currentUserScope) {
      blockedSessionIdRef.current = session;
      const didSwitchSession = activateSession(INBOX_SESSION_ID);
      if (!didSwitchSession) normalizeQueryToInbox(session);
      return;
    }

    if (!isSessionListInit) return;

    const sessionExists = sessions.some((item) => item.id === session);
    const acceptedSessionId = sessionExists ? session : INBOX_SESSION_ID;
    const didSwitchSession = activateSession(acceptedSessionId);
    if (sessionExists) {
      blockedSessionIdRef.current = undefined;
      pendingInboxNormalizationRef.current = undefined;
    } else {
      blockedSessionIdRef.current = session;
      if (!didSwitchSession) normalizeQueryToInbox(session);
    }
  }, [
    activateSession,
    currentUserScope,
    hasOwnerMismatch,
    isOwnershipVerified,
    isSessionListInit,
    normalizeQueryToInbox,
    session,
    sessions,
    setSession,
  ]);

  return null;
});

export default SessionHydration;
