'use client';

import type { SandboxProfileItem } from '@lobechat/types';
import { Alert, Button, Modal } from '@lobehub/ui';
import { Input, Popconfirm } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { SANDBOX_INSTRUCTION_MAX_BYTES } from '@/tools/sandbox/const';

import type { InstructionAccess } from './ProfileSection';

const useStyles = createStyles(({ css, token }) => ({
  editor: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
  `,
  hint: css`
    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.6;
  `,
  instruction: css`
    overflow: auto;

    max-height: 60vh;
    margin: 0;
    padding: 12px;
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
}));

/** `{{name}}` is filled in by the chat template step before the model sees it. */
const PLACEHOLDER = /{{\s*[\w.-]+\s*}}/;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

interface InstructionModalProps {
  access?: InstructionAccess;
  onClose: () => void;
  onReset: () => Promise<void>;
  onSave: (instruction: string) => Promise<void>;
  open: boolean;
  profile?: SandboxProfileItem;
}

/** A profile's model instruction: read-only for users, editable for Sandbox Hub admins. */
const InstructionModal = memo<InstructionModalProps>(
  ({ access, onClose, onReset, onSave, open, profile }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);

    const canEdit = !!access?.canEdit;
    const original = profile?.instruction ?? '';

    useEffect(() => {
      if (!open) return;
      setDraft(original);
      setFailed(false);
    }, [open, original]);

    const draftBytes = byteLength(draft);
    const tooLarge = draftBytes > SANDBOX_INSTRUCTION_MAX_BYTES;
    const canSave = !saving && !tooLarge && draft.trim().length > 0 && draft !== original;

    const run = async (change: () => Promise<void>) => {
      setSaving(true);
      setFailed(false);
      try {
        await change();
        onClose();
      } catch {
        setFailed(true);
      } finally {
        setSaving(false);
      }
    };

    const footer = canEdit ? (
      <Flexbox gap={8} horizontal justify={'space-between'}>
        <div>
          {profile?.instructionCustomized && (
            <Popconfirm
              cancelText={t('profile.instruction.cancel')}
              okText={t('profile.instruction.reset')}
              onConfirm={() => run(onReset)}
              title={t('profile.instruction.resetConfirm')}
            >
              <Button danger disabled={saving}>
                {t('profile.instruction.reset')}
              </Button>
            </Popconfirm>
          )}
        </div>
        <Flexbox gap={8} horizontal>
          <Button disabled={saving} onClick={onClose}>
            {t('profile.instruction.cancel')}
          </Button>
          <Button
            disabled={!canSave}
            loading={saving}
            onClick={() => run(() => onSave(draft))}
            type={'primary'}
          >
            {t('profile.instruction.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    ) : (
      <Flexbox horizontal justify={'flex-end'}>
        <Button onClick={onClose}>{t('profile.instruction.close')}</Button>
      </Flexbox>
    );

    return (
      <Modal
        footer={footer}
        // Readers can dismiss from the backdrop or Escape. An admin's draft
        // closes only from Cancel or the X button.
        keyboard={!canEdit}
        maskClosable={!canEdit}
        onCancel={onClose}
        open={open}
        title={t('profile.instruction.title', { name: profile?.name ?? '' })}
        width={760}
        zIndex={1200}
      >
        {canEdit ? (
          <Flexbox gap={10}>
            <div className={styles.hint}>{t('profile.instruction.editHint')}</div>
            <Input.TextArea
              aria-label={t('profile.instruction.editLabel', { name: profile?.name ?? '' })}
              autoSize={{ maxRows: 24, minRows: 10 }}
              className={styles.editor}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            <div className={styles.hint}>
              {t('profile.instruction.size', {
                max: SANDBOX_INSTRUCTION_MAX_BYTES / 1024,
                size: (draftBytes / 1024).toFixed(1),
              })}
            </div>
            {tooLarge && (
              <Alert
                message={t('profile.instruction.tooLarge', {
                  max: SANDBOX_INSTRUCTION_MAX_BYTES / 1024,
                })}
                showIcon
                type={'error'}
              />
            )}
            {PLACEHOLDER.test(draft) && (
              <Alert
                message={t('profile.instruction.placeholderWarning', { example: '{{date}}' })}
                showIcon
                type={'warning'}
              />
            )}
            {failed && (
              <Alert message={t('profile.instruction.saveFailed')} showIcon type={'error'} />
            )}
          </Flexbox>
        ) : (
          <Flexbox gap={10}>
            <pre className={styles.instruction}>{original}</pre>
            {access && (
              <div className={styles.hint}>
                {access.adminsConfigured
                  ? t('profile.instruction.readOnly')
                  : t('profile.instruction.readOnlyNoAdmins')}
              </div>
            )}
          </Flexbox>
        )}
      </Modal>
    );
  },
);

InstructionModal.displayName = 'SandboxHubInstructionModal';

export default InstructionModal;
