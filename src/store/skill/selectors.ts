import { SkillStore } from './store';

const enabledMetadata = (identifiers: string[]) => (state: SkillStore) => {
  const enabled = new Set(identifiers);
  return state.installedSkills.filter(({ identifier }) => enabled.has(identifier));
};

const getSkillById = (identifier: string) => (state: SkillStore) =>
  state.installedSkills.find((skill) => skill.identifier === identifier);

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

export const skillSelectors = { enabledMetadata, getSkillById, selectedSkillIds };
