'use client';

import { useEffect } from 'react';

import { isClientDurableConversationGenerationEnabled } from '@/helpers/durableConversationGeneration';
import { conversationGenerationService } from '@/services/conversationGeneration';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';

export const useConversationGenerationSync = () => {
  const sessionId = useSessionStore((s) => s.activeId);
  const topicId = useChatStore((s) => s.activeTopicId);
  const applyEvent = useChatStore((s) => s.applyConversationGenerationEvent);
  const syncActive = useChatStore((s) => s.syncActiveConversationGenerations);

  useEffect(() => {
    if (!isClientDurableConversationGenerationEnabled()) return;

    const abortController = new AbortController();
    let cursor = 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const handleEvent = (event: any) => {
      if (event?.type === 'reset' || event?.reset) {
        cursor = 0;
        return;
      }
      if (typeof event?.id === 'number') cursor = event.id;
      applyEvent(event);
    };

    const startPoll = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void conversationGenerationService
          .listEvents(cursor)
          .then((page) => {
            if (page.reset) cursor = 0;
            for (const event of page.events) handleEvent(event);
            cursor = page.cursor;
          })
          .catch(() => undefined);
      }, 2000);
    };

    void syncActive().catch(console.error);
    void conversationGenerationService
      .subscribe({
        cursor,
        onEvent: handleEvent,
        signal: abortController.signal,
      })
      .catch(() => {
        if (!abortController.signal.aborted) startPoll();
      });

    return () => {
      abortController.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [applyEvent, sessionId, syncActive, topicId]);
};
