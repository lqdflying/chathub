import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSkillStore } from '@/store/skill';

import Action from '../components/Action';
import { useControls } from './useControls';

const Skills = memo(() => {
  const { t } = useTranslation('setting');
  const items = useControls();
  const enabledSkillIds = useAgentStore(agentSelectors.currentAgentSkills);
  const hasSkills = useSkillStore((s) =>
    s.installedSkills.some(({ identifier }) => enabledSkillIds.includes(identifier)),
  );
  const isLoading = useSkillStore((s) => s.isLoading);

  if (!hasSkills) return null;

  return (
    <Action
      dropdown={{
        maxHeight: 500,
        maxWidth: 480,
        menu: { items },
        minWidth: 320,
      }}
      icon={Sparkles}
      loading={isLoading}
      title={t('skills.title')}
    />
  );
});

export default Skills;
