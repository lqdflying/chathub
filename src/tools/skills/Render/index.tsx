'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Typography } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

interface SkillLoaderContent {
  contentHash?: unknown;
  identifier?: unknown;
  name?: unknown;
  status?: unknown;
}

const SkillLoaderRender = memo<BuiltinRenderProps<SkillLoaderContent>>(({ content }) => {
  const { t } = useTranslation('tool');
  const isLoadedMarker =
    content &&
    typeof content.contentHash === 'string' &&
    typeof content.identifier === 'string' &&
    typeof content.name === 'string' &&
    content.status === 'loaded';

  if (!isLoadedMarker) return null;

  return (
    <Flexbox align={'center'} gap={6} horizontal>
      <Sparkles aria-hidden size={14} />
      <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('skillLoader.loaded', { name: content.name })}
      </Typography.Text>
    </Flexbox>
  );
});

SkillLoaderRender.displayName = 'SkillLoaderRender';

export default SkillLoaderRender;
