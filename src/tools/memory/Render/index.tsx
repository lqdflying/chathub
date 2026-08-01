'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

interface SaveMemoryContent {
  content?: string;
  index?: number;
  saved?: boolean;
}

/** Minimal confirmation line; before the executor finishes, content is the raw args echo. */
const MemoryRender = memo<BuiltinRenderProps<SaveMemoryContent>>(({ content }) => {
  const { t } = useTranslation('tool');

  if (!content?.saved) return null;

  return (
    <Flexbox align={'center'} gap={6} horizontal>
      <span aria-hidden style={{ fontSize: 14 }}>
        🧠
      </span>
      <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('memory.saved', { index: content.index })}
        {content.content ? ` — ${content.content}` : ''}
      </Typography.Text>
    </Flexbox>
  );
});

MemoryRender.displayName = 'MemoryRender';

export default MemoryRender;
