'use client';

import type { ConversationGenerationStreamEvent } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

const cursorByUser = new Map<string, number>();

export const useConversationGenerationSync = () => {
  const userId = useUserStore((s) => s.user?.id);
  const sessionId = useSessionStore((s) => s.activeId);
  const topicId = useChatStore((s) => s.activeTopicId);
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
  }, [sessionId, syncActive, topicId, userId]);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled() || !userId) return;

    const abortController = new AbortController();
    let cursor = cursorByUser.get(userId) ?? 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pollInFlight = false;

    const persistCursor = (nextCursor: number) => {
      cursor = nextCursor;
      cursorByUser.set(userId, nextCursor);
    };

    const handleEvent = (event: ConversationGenerationStreamEvent) => {
      if (event.type === 'reset') {
        persistCursor(0);
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
        .then((page) => {
          if (page.reset) persistCursor(0);
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

    const startPoll = () => {
      if (pollTimer) return;
      pollTimer = setInterval(pollOnce, 2000);
      pollOnce();
    };

    void conversationGenerationService
      .subscribe({
        cursor,
        onEvent: handleEvent,
        signal: abortController.signal,
      })
      .then(() => {
        if (!abortController.signal.aborted) startPoll();
      })
      .catch(() => {
        if (!abortController.signal.aborted) startPoll();
      });

    return () => {
      abortController.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [applyEvent, userId]);
};
