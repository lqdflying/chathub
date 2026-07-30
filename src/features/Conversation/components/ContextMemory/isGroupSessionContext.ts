import { getSessionStoreState } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

/**
 * `chat.activeSessionType` is maintained only by the lazily-mounted useFetchMessages and
 * resets to undefined during session refetches, so it can be transiently unresolved while
 * a group session is active. Fall back to the session store in that window so a group
 * session is never mistaken for an agent one (same pattern as
 * src/store/chat/slices/topic/action.ts).
 */
export const isGroupSessionContext = (
  activeSessionType: 'agent' | 'group' | undefined,
): boolean => {
  if (activeSessionType !== undefined) return activeSessionType === 'group';
  return sessionSelectors.isCurrentSessionGroupSession(getSessionStoreState());
};
