import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { isPendingUncreatedTopicId } from '@/store/chat/utils/pendingTopicClientId';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

export const useFetchMessages = () => {
  const sessionId = useSessionStore((s) => s.activeId);
  const [activeTopicId, useFetchMessages, internal_updateActiveSessionType, pendingUncreated] =
    useChatStore((s) => [
      s.activeTopicId,
      s.useFetchMessages,
      s.internal_updateActiveSessionType,
      isPendingUncreatedTopicId(s.pendingTopicClientIds, s.activeTopicId),
    ]);

  const [currentSession, isGroupSession] = useSessionStore((s) => [
    sessionSelectors.currentSession(s),
    sessionSelectors.isCurrentSessionGroupSession(s),
  ]);

  // Update active session type when session changes
  useEffect(() => {
    if (currentSession?.type) {
      internal_updateActiveSessionType(currentSession.type as 'agent' | 'group');
    } else {
      internal_updateActiveSessionType(undefined);
    }
  }, [currentSession?.id, currentSession?.type, internal_updateActiveSessionType]);

  useFetchMessages(
    !pendingUncreated,
    sessionId,
    activeTopicId,
    isGroupSession ? 'group' : 'session',
  );
};
