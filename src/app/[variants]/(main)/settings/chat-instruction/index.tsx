'use client';

import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { Button, Form, type FormGroupItemType, Icon } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { Loader2Icon, PenLineIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';

const isInstructionSaveAbort = (error: unknown): boolean => {
  const seenCauses = new Set<unknown>();
  let currentCause = error;

  for (let depth = 0; currentCause && depth < 6 && !seenCauses.has(currentCause); depth += 1) {
    seenCauses.add(currentCause);

    if (currentCause === MESSAGE_CANCEL_FLAT) return true;

    if (currentCause instanceof Error) {
      const errorMessage = currentCause.message.toLowerCase();
      const isAbortError =
        currentCause.name === 'AbortError' ||
        errorMessage === MESSAGE_CANCEL_FLAT ||
        errorMessage === 'cancelled' ||
        errorMessage.includes('operation was aborted') ||
        errorMessage.includes('request was aborted') ||
        errorMessage.includes('user aborted');

      if (isAbortError) return true;
    }

    currentCause =
      typeof currentCause === 'object'
        ? (currentCause as { cause?: unknown }).cause
        : undefined;
  }

  return false;
};

const useStyles = createStyles(({ css }) => ({
  instructionPreview: css`
    min-width: 0;
    max-height: 160px;
    overflow: auto;
  `,
  instructionPreviewWrapper: css`
    min-width: 0;
  `,
}));

const ChatInstruction = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const generalInstruction =
    useUserStore(userGeneralSettingsSelectors.generalInstruction) ?? '';
  const [setSettings, isUserStateInit] = useUserStore((state) => [
    state.setSettings,
    state.isUserStateInit,
  ]);
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false);
  const [instructionEditing, setInstructionEditing] = useState(false);
  const [instructionSaving, setInstructionSaving] = useState(false);
  const instructionSaveOperation = useRef(0);
  const confirmedInstruction = useRef(generalInstruction);

  useEffect(() => {
    if (!instructionSaving) confirmedInstruction.current = generalInstruction;
  }, [generalInstruction, instructionSaving]);

  const handleInstructionEditorOpenChange = (open: boolean) => {
    setInstructionEditorOpen(open);
    if (!open) setInstructionEditing(false);
  };

  const handleInstructionChange = async (updatedInstruction: string) => {
    if (updatedInstruction === generalInstruction) {
      setInstructionEditing(false);
      setInstructionEditorOpen(false);
      return;
    }

    const saveOperation = ++instructionSaveOperation.current;
    const previousInstruction = confirmedInstruction.current;
    setInstructionSaving(true);
    setInstructionEditing(false);
    setInstructionEditorOpen(false);

    try {
      await setSettings(
        { general: { generalInstruction: updatedInstruction } },
        { skipRefresh: true },
      );
      if (saveOperation === instructionSaveOperation.current) {
        confirmedInstruction.current = updatedInstruction;
      }
    } catch (error) {
      const isCurrentSave = saveOperation === instructionSaveOperation.current;
      if (!isCurrentSave || isInstructionSaveAbort(error)) return;

      useUserStore.setState((state) => ({
        settings: {
          ...state.settings,
          general: {
            ...state.settings.general,
            generalInstruction: previousInstruction,
          },
        },
      }));
    } finally {
      if (saveOperation === instructionSaveOperation.current) setInstructionSaving(false);
    }
  };

  const handleInstructionEdit = () => {
    setInstructionEditing(true);
    setInstructionEditorOpen(true);
  };

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;

  const instructionGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Flexbox align={'flex-start'} gap={12} horizontal width={'100%'}>
            <Flexbox className={styles.instructionPreviewWrapper} flex={1}>
              <EditableMessage
                classNames={{ markdown: styles.instructionPreview }}
                editing={instructionEditing}
                height={'auto'}
                markdownProps={{
                  enableLatex: false,
                  enableMermaid: false,
                  variant: 'chat',
                }}
                onChange={handleInstructionChange}
                onEditingChange={setInstructionEditing}
                onOpenChange={handleInstructionEditorOpenChange}
                openModal={instructionEditorOpen}
                placeholder={t('chatInstruction.placeholder')}
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                  edit: t('edit', { ns: 'common' }),
                  title: t('chatInstruction.title'),
                }}
                value={generalInstruction}
                variant={'borderless'}
              />
            </Flexbox>
            <Button
              icon={PenLineIcon}
              iconPosition={'end'}
              iconProps={{ size: 12 }}
              onClick={handleInstructionEdit}
              size={'small'}
              type={'primary'}
            >
              {t('edit', { ns: 'common' })}
            </Button>
          </Flexbox>
        ),
        desc: t('chatInstruction.desc'),
        label: t('chatInstruction.title'),
        minWidth: undefined,
      },
    ],
    extra: instructionSaving && (
      <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
    ),
    title: t('chatInstruction.title'),
  };

  return (
    <Form
      items={[instructionGroup]}
      itemsType={'group'}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

ChatInstruction.displayName = 'ChatInstructionSetting';

export default ChatInstruction;
