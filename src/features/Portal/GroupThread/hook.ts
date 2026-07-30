import { useChatStore } from '@/store/chat';
import { useChatGroupStore } from '@/store/chatGroup';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

// Only enable the group-thread portal when a thread agent is selected AND the active
// session is actually a group session. A stale activeThreadAgentId left over from a
// previous group session must not render this portal (which mounts a second ChatInput +
// MemoryContextOrchestrator) over a regular agent session.
export const useEnable = () => {
  const hasThreadAgent = useChatGroupStore((s) => !!s.activeThreadAgentId);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);
  return hasThreadAgent && isGroupSession;
};

export const onClose = () => {
  useChatGroupStore.setState({ activeThreadAgentId: '' });
  useChatStore.getState().togglePortal(false);
};
