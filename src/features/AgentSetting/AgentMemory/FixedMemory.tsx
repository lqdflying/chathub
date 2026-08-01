'use client';

import { ActionIcon, Button, Form } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { App, Input, Popconfirm } from 'antd';
import { createStyles } from 'antd-style';
import { PenLineIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import {
  type FixedMemoryEntry,
  appendFixedMemoryEntry,
  deleteFixedMemoryEntry,
  parseFixedMemoryEntries,
  renumberFixedMemoryEntries,
  updateFixedMemoryEntry,
} from '@/helpers/assistantMemory';

import { useStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 12px 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  content: css`
    flex: 1;
    min-width: 0;

    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  hint: css`
    font-size: 12px;
    color: ${token.colorTextDescription};
  `,
  index: css`
    padding-top: 2px;
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `,
}));

const ENTRY_LINE = /^#\d+:/;

/**
 * User-curated fixed memory, managed as one card per numbered entry (like
 * Claude Projects): inline edit and delete per entry plus quick add. The raw
 * document editor stays behind the Edit button for free-form markdown; every
 * entry operation reuses the verified helpers shared with the LLM tool, so
 * numbering stays dense and non-entry lines are preserved verbatim.
 */
const FixedMemory = memo(() => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const { styles } = useStyles();

  const [editingDoc, setEditingDoc] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [fixedMemory, updateConfig] = useStore((s) => [s.config.fixedMemory, s.setAgentConfig]);

  const entries = parseFixedMemoryEntries(fixedMemory);
  const hasFreeformLines = (fixedMemory ?? '')
    .split('\n')
    .some((line) => line.trim() && !ENTRY_LINE.test(line));

  // the write can fail after the optimistic local update — surface it
  const persist = (nextDoc: string) => {
    Promise.resolve(updateConfig({ fixedMemory: nextDoc }))
      .then(() => {
        message.success(t('settingChatMemory.saveSuccess'));
      })
      .catch((error) => {
        message.error(
          t('settingChatMemory.saveFailedWithReason', {
            reason: (error as Error)?.message || String(error ?? 'unknown error'),
          }),
        );
      });
  };

  const onDeleteEntry = (entry: FixedMemoryEntry) => {
    const outcome = deleteFixedMemoryEntry(fixedMemory, entry.index, entry.content);
    // only possible if the doc changed underneath this view (e.g. a tool write);
    // the list re-renders from the refreshed config, so just report it
    if ('error' in outcome) {
      message.error(t('settingChatMemory.saveFailedWithReason', { reason: outcome.error }));
      return;
    }
    persist(outcome.doc);
  };

  const onSaveEntry = (entry: FixedMemoryEntry) => {
    const next = editDraft.trim();
    setEditingIndex(null);
    if (!next || next === entry.content) return;

    const outcome = updateFixedMemoryEntry(fixedMemory, entry.index, entry.content, next);
    if ('error' in outcome) {
      message.error(t('settingChatMemory.saveFailedWithReason', { reason: outcome.error }));
      return;
    }
    persist(outcome.doc);
  };

  const onAddEntry = () => {
    const content = addDraft.trim();
    setAdding(false);
    setAddDraft('');
    if (!content) return;

    persist(appendFixedMemoryEntry(fixedMemory, content).doc);
  };

  const editButton = !editingDoc && !!fixedMemory && (
    <Button
      icon={PenLineIcon}
      iconPosition={'end'}
      iconProps={{
        size: 12,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setEditingDoc(true);
      }}
      size={'small'}
      type={'primary'}
    >
      {t('edit', { ns: 'common' })}
    </Button>
  );

  const entryCards = (
    <Flexbox gap={8}>
      {entries.map((entry, i) => (
        <Flexbox className={styles.card} gap={8} key={`${entry.index}-${i}`}>
          {editingIndex === entry.index ? (
            <>
              <Input.TextArea
                autoFocus
                autoSize={{ maxRows: 8, minRows: 2 }}
                onChange={(e) => setEditDraft(e.target.value)}
                value={editDraft}
              />
              <Flexbox gap={8} horizontal justify={'flex-end'}>
                <Button onClick={() => setEditingIndex(null)} size={'small'}>
                  {t('cancel', { ns: 'common' })}
                </Button>
                <Button onClick={() => onSaveEntry(entry)} size={'small'} type={'primary'}>
                  {t('ok', { ns: 'common' })}
                </Button>
              </Flexbox>
            </>
          ) : (
            <Flexbox align={'flex-start'} gap={12} horizontal>
              <span className={styles.index}>#{entry.index}</span>
              <div className={styles.content}>{entry.content}</div>
              <Flexbox gap={2} horizontal>
                <ActionIcon
                  icon={PencilIcon}
                  onClick={() => {
                    setAdding(false);
                    setEditDraft(entry.content);
                    setEditingIndex(entry.index);
                  }}
                  size={'small'}
                  title={t('edit', { ns: 'common' })}
                />
                <Popconfirm
                  cancelText={t('cancel', { ns: 'common' })}
                  okText={t('ok', { ns: 'common' })}
                  onConfirm={() => onDeleteEntry(entry)}
                  title={t('settingChatMemory.fixedMemory.deleteConfirm')}
                >
                  <ActionIcon
                    icon={Trash2Icon}
                    size={'small'}
                    title={t('delete', { ns: 'common' })}
                  />
                </Popconfirm>
              </Flexbox>
            </Flexbox>
          )}
        </Flexbox>
      ))}
      {entries.length === 0 && !adding && (
        <div className={styles.hint}>{t('settingChatMemory.fixedMemory.placeholder')}</div>
      )}
      {hasFreeformLines && (
        <div className={styles.hint}>{t('settingChatMemory.fixedMemory.freeformHint')}</div>
      )}
      {adding ? (
        <Flexbox className={styles.card} gap={8}>
          <Input.TextArea
            autoFocus
            autoSize={{ maxRows: 8, minRows: 2 }}
            onChange={(e) => setAddDraft(e.target.value)}
            placeholder={t('settingChatMemory.fixedMemory.addPlaceholder')}
            value={addDraft}
          />
          <Flexbox gap={8} horizontal justify={'flex-end'}>
            <Button
              onClick={() => {
                setAdding(false);
                setAddDraft('');
              }}
              size={'small'}
            >
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button onClick={onAddEntry} size={'small'} type={'primary'}>
              {t('ok', { ns: 'common' })}
            </Button>
          </Flexbox>
        </Flexbox>
      ) : (
        <Button
          block
          icon={PlusIcon}
          onClick={() => {
            setEditingIndex(null);
            setAdding(true);
          }}
          type={'dashed'}
        >
          {t('settingChatMemory.fixedMemory.addEntry')}
        </Button>
      )}
      {!!fixedMemory && <Tokens value={fixedMemory} />}
    </Flexbox>
  );

  return (
    <Form
      items={[
        {
          children: editingDoc ? (
            <EditableMessage
              editing
              height={'auto'}
              markdownProps={{
                variant: 'chat',
              }}
              onChange={(value) => {
                // dense renumbering on user save: deleting #2 makes #3 become #2;
                // only `#N:` lines are rewritten, free-form markdown stays untouched
                persist(renumberFixedMemoryEntries(value));
              }}
              onEditingChange={setEditingDoc}
              placeholder={t('settingChatMemory.fixedMemory.placeholder')}
              text={{
                cancel: t('cancel', { ns: 'common' }),
                confirm: t('ok', { ns: 'common' }),
              }}
              value={fixedMemory ?? ''}
              variant={'borderless'}
            />
          ) : (
            entryCards
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
