import { ItemType } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { getSkillSelectionKey, skillSelectors, useSkillStore } from '@/store/skill';

import CheckboxItem from '../components/CheckbokWithLoading';

export const useControls = (): ItemType[] => {
  const { t } = useTranslation('setting');
  const [activeId, activeTopicId, activeThreadId] = useChatStore((s) => [
    s.activeId,
    s.activeTopicId,
    s.activeThreadId,
  ]);
  const selectionKey = getSkillSelectionKey({
    sessionId: activeId,
    threadId: activeThreadId,
    topicId: activeTopicId,
  });
  const skills = useSkillStore((s) => s.installedSkills);
  const selected = useSkillStore(skillSelectors.selectedSkillIds(selectionKey));
  const toggle = useSkillStore((s) => s.toggleSelectedSkill);
  const useFetchSkills = useSkillStore((s) => s.useFetchSkills);

  useFetchSkills();

  return [
    {
      children: skills
        .map((skill) => ({
          key: skill.identifier,
          label: (
            <CheckboxItem
              checked={selected.includes(skill.identifier)}
              id={skill.identifier}
              label={skill.name}
              onUpdate={async (id, enabled) => toggle(id, enabled, selectionKey)}
            />
          ),
        })),
      key: 'skills',
      label: t('skills.groupName'),
      type: 'group',
    },
  ];
};
