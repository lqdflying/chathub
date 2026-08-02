import { ItemType } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSkillStore } from '@/store/skill';

import CheckboxItem from '../components/CheckbokWithLoading';

export const useControls = (): ItemType[] => {
  const { t } = useTranslation('setting');
  const enabledIds = useAgentStore(agentSelectors.currentAgentSkills);
  const skills = useSkillStore((s) => s.installedSkills);
  const selected = useSkillStore((s) => s.selectedSkillIds);
  const toggle = useSkillStore((s) => s.toggleSelectedSkill);
  const useFetchSkills = useSkillStore((s) => s.useFetchSkills);

  useFetchSkills();

  return [
    {
      children: skills
        .filter(({ identifier }) => enabledIds.includes(identifier))
        .map((skill) => ({
          key: skill.identifier,
          label: (
            <CheckboxItem
              checked={selected.includes(skill.identifier)}
              id={skill.identifier}
              label={skill.name}
              onUpdate={async (id, enabled) => toggle(id, enabled)}
            />
          ),
        })),
      key: 'skills',
      label: t('skills.groupName'),
      type: 'group',
    },
  ];
};
