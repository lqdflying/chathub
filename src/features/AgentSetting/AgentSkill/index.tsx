import { Form } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useSkillStore } from '@/store/skill';

import { useStore } from '../store';

const AgentSkill = memo(() => {
  const { t } = useTranslation('setting');
  const skills = useSkillStore((s) => s.installedSkills, isEqual);
  const useFetchSkills = useSkillStore((s) => s.useFetchSkills);
  const [enabled, toggle] = useStore((s) => [s.config.skills || [], s.toggleAgentSkill]);

  useFetchSkills();

  const items = skills.map((skill) => ({
    children: (
      <Switch
        checked={enabled.includes(skill.identifier)}
        onChange={(checked) => toggle(skill.identifier, checked)}
      />
    ),
    desc: skill.description,
    label: skill.name,
    layout: 'horizontal' as const,
  }));

  return (
    <Form
      items={items}
      itemsType="group"
      title={t('skills.agentTitle')}
      variant="borderless"
      {...FORM_STYLE}
    />
  );
});

export default AgentSkill;
