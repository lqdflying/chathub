'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

interface MemoryToolContent {
  content?: string;
  deleted?: boolean;
  index?: number;
  saved?: boolean;
  updated?: boolean;
}

/**
 * Minimal confirmation line for save/update/delete. Verification-error results
 * ({error, currentEntries}) and the pre-execution args echo render nothing —
 * the model handles correction; there is nothing user-actionable.
 */
const MemoryRender = memo<BuiltinRenderProps<MemoryToolContent>>(({ content }) => {
  const { t } = useTranslation('tool');

  let text: string | undefined;
  if (content?.saved) text = t('memory.saved', { index: content.index });
  else if (content?.updated) text = t('memory.updated', { index: content.index });
  else if (content?.deleted) text = t('memory.deleted');

  if (!text) return null;

  return (
    <Flexbox align={'center'} gap={6} horizontal>
      <span aria-hidden style={{ fontSize: 14 }}>
        🧠
      </span>
      <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
        {text}
        {(content?.saved || content?.updated) && content?.content ? ` — ${content.content}` : ''}
      </Typography.Text>
    </Flexbox>
  );
});

MemoryRender.displayName = 'MemoryRender';

export default MemoryRender;
