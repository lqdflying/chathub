'use client';

import { Button, Form } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { App } from 'antd';
import { PenLineIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';

import { useStore } from '../store';

/**
 * User-curated fixed memory: always injected, never touched by the automatic
 * rollup. Commit-on-confirm editing (like the system role editor) so a
 * background refresh can never discard an in-progress draft silently.
 */
const FixedMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [fixedMemory, updateConfig] = useStore((s) => [s.config.fixedMemory, s.setAgentConfig]);

  const editButton = !editing && !!fixedMemory && (
    <Button
      icon={PenLineIcon}
      iconPosition={'end'}
      iconProps={{
        size: 12,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      size={'small'}
      type={'primary'}
    >
      {t('edit', { ns: 'common' })}
    </Button>
  );

  return (
    <Form
      items={[
        {
          children: (
            <Flexbox gap={8}>
              <EditableMessage
                editing={editing}
                height={'auto'}
                markdownProps={{
                  variant: 'chat',
                }}
                onChange={(value) => {
                  // the write can fail after the optimistic local update — surface it
                  Promise.resolve(updateConfig({ fixedMemory: value })).catch((error) => {
                    message.error(
                      t('settingChatMemory.saveFailedWithReason', {
                        reason: (error as Error)?.message || String(error ?? 'unknown error'),
                      }),
                    );
                  });
                }}
                onEditingChange={setEditing}
                placeholder={t('settingChatMemory.fixedMemory.placeholder')}
                showEditWhenEmpty
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                }}
                value={fixedMemory ?? ''}
                variant={'borderless'}
              />
              {!editing && !!fixedMemory && <Tokens value={fixedMemory} />}
            </Flexbox>
          ),
          desc: t('settingChatMemory.fixedMemory.hint'),
          extra: editButton,
          title: t('settingChatMemory.fixedMemory.title'),
        },
      ]}
      itemsType={'group'}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

FixedMemory.displayName = 'FixedMemory';

export default FixedMemory;
