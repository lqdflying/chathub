'use client';

import type { ConversationGenerationStreamEvent } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
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
  const previousUserId = useRef(userId);

  useEffect(() => {
    if (previousUserId.current !== userId && userId) cursorByUser.delete(userId);
    previousUserId.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled()) return;
    void syncActive().catch(console.error);
  }, [sessionId, syncActive, topicId, userId, activeThreadId, portalThreadId]);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled() || !userId) return;

    const abortController = new AbortController();
    let cursor = cursorByUser.get(userId) ?? 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollInFlight = false;
    let reconnectAttempts = 0;
    let connecting = false;

    const persistCursor = (nextCursor: number) => {
      cursor = nextCursor;
      cursorByUser.set(userId, nextCursor);
    };

    const replayFromStart = async () => {
      persistCursor(0);
      await syncActive().catch(console.error);
      if (abortController.signal.aborted) return;
      const replay = await conversationGenerationService.listEvents(0);
      if (abortController.signal.aborted) return;
      for (const event of replay.events) {
        if (typeof event.id === 'number') persistCursor(event.id);
        applyEvent(event);
      }
      persistCursor(replay.cursor);
    };

    const handleEvent = (event: ConversationGenerationStreamEvent) => {
      reconnectAttempts = 0;
      if (event.type === 'reset') {
        void replayFromStart().catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[conversation-generation] reset replay failed', error);
          }
        });
        return;
      }
      if (typeof event.id === 'number') persistCursor(event.id);
      applyEvent(event);
    };

    const pollOnce = () => {
      if (pollInFlight || abortController.signal.aborted) return;
      pollInFlight = true;
      void conversationGenerationService
        .listEvents(cursor)
        .then(async (page) => {
          if (abortController.signal.aborted) return;
          if (page.reset) {
            await replayFromStart();
            return;
          }
          for (const event of page.events) handleEvent(event);
          persistCursor(page.cursor);
        })
        .catch((error) => {
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
          onEvent: handleEvent,
          signal: abortController.signal,
        })
        .then(() => {
          connecting = false;
          if (abortController.signal.aborted) return;
          startPoll();
          const delay = Math.min(250 * 2 ** reconnectAttempts, SSE_RECONNECT_MAX_MS);
          reconnectAttempts += 1;
          reconnectTimer = setTimeout(() => {
            if (abortController.signal.aborted) return;
            stopPoll();
            connect();
          }, delay);
        })
        .catch(() => {
          connecting = false;
          if (abortController.signal.aborted) return;
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
  }, [applyEvent, syncActive, userId]);
};
