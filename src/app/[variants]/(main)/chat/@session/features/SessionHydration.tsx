'use client';

import { useQueryState } from 'nuqs';
import { parseAsString } from 'nuqs/server';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';

// sync outside state to useSessionStore
const SessionHydration = memo(() => {
  const useStoreUpdater = createStoreUpdater(useSessionStore);
  const useAgentStoreUpdater = createStoreUpdater(useAgentStore);
  const [internalUpdateActiveId, switchTopic] = useChatStore((s) => [
    s.internal_updateActiveId,
    s.switchTopic,
  ]);

  // two-way bindings the url and session store
  const [session, setSession] = useQueryState(
    'session',
    parseAsString.withDefault('inbox').withOptions({ history: 'replace', throttleMs: 50 }),
  );
  useStoreUpdater('activeId', session);
  useAgentStoreUpdater('activeId', session);

  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe(
      (s) => s.activeId,
      (state) => {
        internalUpdateActiveId(state);
        void switchTopic(undefined, true);
        setSession(state);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [internalUpdateActiveId, setSession, switchTopic]);

  useEffect(() => {
    internalUpdateActiveId(session);
  }, [internalUpdateActiveId, session]);

  return null;
});

export default SessionHydration;
