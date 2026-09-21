'use client';

import type { ConversationGenerationStreamEvent } from '@lobechat/types';
import { useEffect, useRef, useState } from 'react';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { logGenerationDebugClientSafe } from '@/libs/logger/generationDebugClient';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
import { shouldPersistConversationGenerationCursor } from '@/store/chat/slices/aiChat/actions/conversationGeneration';
import {
  flushEventDropSummary,
  resetEventDroppedDebugState,
} from '@/store/chat/slices/aiChat/actions/eventDroppedDebug';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

const cursorByUser = new Map<string, number>();
const SSE_RECONNECT_MAX_MS = 15_000;

export const useConversationGenerationSync = () => {
  const userId = useUserStore((s) => s.user?.id);
  const sessionId = useSessionStore((s) => s.activeId);
  const topicId = useChatStore((s) => s.activeTopicId);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const portalThreadId = useChatStore((s) => s.portalThreadId);
  const applyEvent = useChatStore((s) => s.applyConversationGenerationEvent);
  const syncActive = useChatStore((s) => s.syncActiveConversationGenerations);
  const notifyDeferredLanesLeft = useChatStore((s) => s.internal_notifyDeferredLanesLeft);
  const previousUserId = useRef(userId);
  const navigationRef = useRef<{
    portalThreadId?: string | null;
    sessionId?: string;
    threadId?: string | null;
    topicId?: string | null;
    userId?: string;
  } | null>(null);
  const [resumeNonce, setResumeNonce] = useState(0);

  useEffect(() => {
    if (previousUserId.current !== userId) {
      if (userId) cursorByUser.delete(userId);
      flushEventDropSummary();
      resetEventDroppedDebugState();
    }
    previousUserId.current = userId;
  }, [userId]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const state = useChatStore.getState();
        const activeSessionId = useSessionStore.getState().activeId;
        if (activeSessionId) {
          state.internal_notifyDeferredLanesLeft({
            sessionId: activeSessionId,
            topicId: state.activeTopicId,
            type: 'visibility',
          });
        }
      }
      if (document.visibilityState === 'visible') setResumeNonce((value) => value + 1);
    };
    const onPageShow = (event: Event) => {
      if ('persisted' in event && (event as PageTransitionEvent).persisted) {
        setResumeNonce((value) => value + 1);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled()) return;
    const previous = navigationRef.current;
    let reason: 'initial' | 'session_change' | 'thread_change' | 'topic_change' | 'visibility' =
      'initial';
    if (previous) {
      if (previous.userId !== userId) reason = 'initial';
      else if (previous.sessionId !== sessionId) reason = 'session_change';
      else if (previous.topicId !== topicId) reason = 'topic_change';
      else if (previous.threadId !== activeThreadId || previous.portalThreadId !== portalThreadId) {
        reason = 'thread_change';
      } else {
        reason = 'visibility';
      }

      if (
        previous.sessionId &&
        (reason === 'session_change' || reason === 'topic_change' || reason === 'thread_change')
      ) {
        notifyDeferredLanesLeft({
          sessionId: previous.sessionId,
          threadId: reason === 'thread_change' ? previous.threadId : undefined,
          topicId: previous.topicId,
          type: 'navigation',
        });
      }
    }
    navigationRef.current = {
      portalThreadId,
      sessionId,
      threadId: activeThreadId,
      topicId,
      userId,
    };
    void syncActive({ reason }).catch(console.error);
  }, [
    activeThreadId,
    notifyDeferredLanesLeft,
    portalThreadId,
    resumeNonce,
    sessionId,
    syncActive,
    topicId,
    userId,
  ]);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled() || !userId) return;

    const abortController = new AbortController();
    let cursor = cursorByUser.get(userId) ?? 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollInFlight = false;
    let pollFailedLogged = false;
    let reconnectAttempts = 0;
    let connecting = false;

    const persistCursor = (nextCursor: number) => {
      cursor = nextCursor;
      cursorByUser.set(userId, nextCursor);
    };

    let withheldOwnedCursor: number | undefined;

    const acknowledgeEvent = (eventId: number | undefined, persistable: boolean) => {
      if (typeof eventId !== 'number') return persistable;
      if (!persistable) {
        if (withheldOwnedCursor === undefined || eventId < withheldOwnedCursor) {
          withheldOwnedCursor = eventId;
        }
        return false;
      }
      if (withheldOwnedCursor !== undefined && eventId > withheldOwnedCursor) return false;
      persistCursor(eventId);
      if (withheldOwnedCursor !== undefined && eventId >= withheldOwnedCursor) {
        withheldOwnedCursor = undefined;
      }
      return true;
    };

    const resyncFromReset = async (resetCursor?: number) => {
      // Persist the reset boundary before awaiting sync so later frames
      // can advance past it. Do not write the stale reset cursor after
      // sync — that would rewind over events delivered during the wait.
      withheldOwnedCursor = undefined;
      if (typeof resetCursor === 'number' && Number.isFinite(resetCursor) && resetCursor >= 0) {
        persistCursor(resetCursor);
      }
      await syncActive().catch(console.error);
      if (abortController.signal.aborted) return;
      logGenerationDebugClientSafe('sse_client_reset_replay', {
        cursor: typeof resetCursor === 'number' ? resetCursor : cursor,
        eventCount: 0,
      });
      flushEventDropSummary();
    };

    const handleEvent = (event: ConversationGenerationStreamEvent) => {
      reconnectAttempts = 0;
      if (event.type === 'reset') {
        void resyncFromReset(event.cursor).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[conversation-generation] reset resync failed', error);
          }
        });
        return true;
      }
      const persistable = shouldPersistConversationGenerationCursor(applyEvent(event));
      return acknowledgeEvent(typeof event.id === 'number' ? event.id : undefined, persistable);
    };

    const pollOnce = () => {
      if (pollInFlight || abortController.signal.aborted) return;
      pollInFlight = true;
      void conversationGenerationService
        .listEvents(cursor, cursorByUser.has(userId) ? { liveTail: false } : undefined)
        .then(async (page) => {
          if (abortController.signal.aborted) return;
          pollFailedLogged = false;
          if (page.reset) {
            await resyncFromReset(page.cursor);
            return;
          }
          let persistPageCursor = true;
          for (const event of page.events) {
            if (!handleEvent(event)) persistPageCursor = false;
          }
          if (persistPageCursor) persistCursor(page.cursor);
        })
        .catch((error) => {
          // Poll runs every 2s; log only the first failure per episode so a
          // sustained outage produces one event, not a flood.
          if (!pollFailedLogged) {
            pollFailedLogged = true;
            logGenerationDebugClientSafe('sse_client_poll_failed', {
              errorType: error instanceof Error ? error.name : typeof error,
            });
          }
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[conversation-generation] poll failed', error);
          }
        })
        .finally(() => {
          pollInFlight = false;
        });
    };

    const stopPoll = () => {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const startPoll = () => {
      if (pollTimer || abortController.signal.aborted) return;
      pollTimer = setInterval(pollOnce, 2000);
      pollOnce();
    };

    const connect = () => {
      if (abortController.signal.aborted || connecting) return;
      connecting = true;
      void conversationGenerationService
        .subscribe({
          cursor,
          established: cursorByUser.has(userId),
          onEvent: handleEvent,
          signal: abortController.signal,
        })
        .then(() => {
          connecting = false;
          if (abortController.signal.aborted) return;
          logGenerationDebugClientSafe('sse_client_stream_ended', { reconnectAttempts });
          flushEventDropSummary();
          startPoll();
          const delay = Math.min(250 * 2 ** reconnectAttempts, SSE_RECONNECT_MAX_MS);
          reconnectAttempts += 1;
          reconnectTimer = setTimeout(() => {
            if (abortController.signal.aborted) return;
            stopPoll();
            connect();
          }, delay);
        })
        .catch((error) => {
          connecting = false;
          if (abortController.signal.aborted) return;
          logGenerationDebugClientSafe('sse_client_stream_failed', {
            errorType: error instanceof Error ? error.name : typeof error,
            reconnectAttempts,
          });
          startPoll();
          const delay = Math.min(250 * 2 ** reconnectAttempts, SSE_RECONNECT_MAX_MS);
          reconnectAttempts += 1;
          reconnectTimer = setTimeout(() => {
            if (abortController.signal.aborted) return;
            stopPoll();
            connect();
          }, delay);
        });
    };

    connect();

    return () => {
      abortController.abort();
      stopPoll();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [applyEvent, resumeNonce, syncActive, userId]);
};
