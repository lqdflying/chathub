import { SkillStore } from './store';

const selectedSkillIds =
  (conversationKey = 'global') =>
  (state: SkillStore) =>
    state.selectedSkillIdsByConversation[conversationKey] || [];

export const getSkillSelectionKey = ({
  sessionId,
  topicId,
  threadId,
}: {
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}) => [sessionId || 'inbox', topicId || 'default', threadId || 'main'].join(':');

export const skillSelectors = { selectedSkillIds };
