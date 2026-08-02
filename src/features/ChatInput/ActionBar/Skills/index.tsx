import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useSkillStore } from '@/store/skill';

import Action from '../components/Action';
import { useControls } from './useControls';

const Skills = memo(() => {
  const { t } = useTranslation('setting');
  const { enableSkills } = useServerConfigStore(featureFlagsSelectors);
  const items = useControls();
  const hasSkills = useSkillStore((s) => s.installedSkills.length > 0);
  const isLoading = useSkillStore((s) => s.isLoading);

  if (!enableSkills || !hasSkills) return null;

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
