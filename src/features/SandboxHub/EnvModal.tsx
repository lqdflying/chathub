'use client';

import type { SandboxEnvItem } from '@lobechat/types';
import { Alert, Button, Modal, Tag } from '@lobehub/ui';
import { Checkbox, Input, Popconfirm } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { Plus } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  SANDBOX_ENV_NAME_PATTERN,
  SANDBOX_ENV_VALUE_MAX_BYTES,
  isReservedSandboxEnvName,
} from '@/tools/sandbox/const';

const useStyles = createStyles(({ css, token }) => ({
  code: css`
    font-family: ${token.fontFamilyCode};
  `,
  editor: css`
    padding: 12px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillQuaternary};
  `,
  empty: css`
    padding-block: 8px;
    font-size: 13px;
    color: ${token.colorTextDescription};
  `,
  error: css`
    font-size: 12px;
    color: ${token.colorError};
  `,
  hint: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  item: css`
    padding-block: 10px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  name: css`
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    overflow-wrap: anywhere;
  `,
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
  `,
  valueHint: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

export type EnvSection = 'mine' | 'shared';

interface Draft {
  name: string;
  /** Replacing a saved variable: its name is fixed. */
  replacing: boolean;
  section: EnvSection;
  /** Checked hides the value. Defaults to checked. */
  sensitive: boolean;
  value: string;
}

interface EnvModalProps {
  /** The server can encrypt values (KEY_VAULTS_SECRET is set). */
  available: boolean;
  canEditShared: boolean;
  entry?: { mine: SandboxEnvItem[]; shared: SandboxEnvItem[] };
  loadFailed?: boolean;
  onClose: () => void;
  onDelete: (section: EnvSection, name: string) => Promise<void>;
  onSave: (section: EnvSection, name: string, value: string, sensitive: boolean) => Promise<void>;
  open: boolean;
  profileName: string;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * A profile's environment variables: the shared ones (admins edit, everyone
 * sees names) and the user's own. Values are typed here and sent once; the
 * server returns a value only when Sensitive is unchecked. A checked value shows a hint.
 */
const EnvModal = memo<EnvModalProps>(
  ({
    available,
    canEditShared,
    entry,
    loadFailed,
    onClose,
    onDelete,
    onSave,
    open,
    profileName,
  }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const [draft, setDraft] = useState<Draft>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
      if (open) return;
      // Drop a typed value as soon as the dialog closes.
      setDraft(undefined);
      setError(undefined);
    }, [open]);

    const run = async (change: () => Promise<void>, after?: () => void) => {
      setBusy(true);
      setError(undefined);
      try {
        await change();
        after?.();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    };

    const nameProblem = (() => {
      if (!draft || draft.replacing || !draft.name) return undefined;
      if (!SANDBOX_ENV_NAME_PATTERN.test(draft.name)) return t('env.invalidName');
      if (isReservedSandboxEnvName(draft.name)) {
        return t('env.reservedName', { name: draft.name });
      }
      return undefined;
    })();
    const tooLarge = !!draft && byteLength(draft.value) > SANDBOX_ENV_VALUE_MAX_BYTES;
    const canSave =
      !!draft && !busy && !!draft.name && draft.value.length > 0 && !nameProblem && !tooLarge;

    const mineNames = new Set(entry?.mine.map((item) => item.name));

    const editor = (section: EnvSection) => {
      if (draft?.section !== section) return null;
      return (
        <Flexbox className={styles.editor} gap={8}>
          <Input
            aria-label={t('env.name')}
            className={styles.code}
            disabled={draft.replacing}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value.trim().toUpperCase() })
            }
            placeholder={'API_TOKEN'}
            value={draft.name}
          />
          {draft.sensitive ? (
            <Input.Password
              aria-label={t('env.value')}
              autoComplete={'new-password'}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              placeholder={
                draft.replacing ? t('env.valueReplacePlaceholder') : t('env.valuePlaceholder')
              }
              value={draft.value}
            />
          ) : (
            <Input
              aria-label={t('env.value')}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              placeholder={t('env.valuePlaceholder')}
              value={draft.value}
            />
          )}
          <Checkbox
            checked={draft.sensitive}
            onChange={(event) => setDraft({ ...draft, sensitive: event.target.checked })}
          >
            {t('env.sensitive')}
          </Checkbox>
          {nameProblem && <div className={styles.error}>{nameProblem}</div>}
          {tooLarge && (
            <div className={styles.error}>
              {t('env.tooLarge', { max: SANDBOX_ENV_VALUE_MAX_BYTES / 1024 })}
            </div>
          )}
          <Flexbox gap={8} horizontal justify={'flex-end'}>
            <Button disabled={busy} onClick={() => setDraft(undefined)} size={'small'}>
              {t('env.cancel')}
            </Button>
            <Button
              disabled={!canSave}
              loading={busy}
              onClick={() =>
                void run(
                  () => onSave(section, draft.name, draft.value, draft.sensitive),
                  () => setDraft(undefined),
                )
              }
              size={'small'}
              type={'primary'}
            >
              {t('env.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    };

    const section = (which: EnvSection) => {
      const editable = which === 'mine' || canEditShared;
      const items = entry?.[which] ?? [];
      const hint =
        which === 'mine'
          ? t('env.mineHint')
          : canEditShared
            ? t('env.sharedHint')
            : t('env.sharedReadOnly');
      return (
        <Flexbox gap={4}>
          <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <span className={styles.sectionTitle}>{t(`env.${which}`)}</span>
              <span className={styles.hint}>{hint}</span>
            </Flexbox>
            {editable && (
              <Button
                disabled={!available || busy || !!draft}
                icon={Plus}
                onClick={() =>
                  setDraft({
                    name: '',
                    replacing: false,
                    section: which,
                    sensitive: true,
                    value: '',
                  })
                }
                size={'small'}
                style={{ flex: 'none' }}
              >
                {t('env.add')}
              </Button>
            )}
          </Flexbox>
          <div>
            {items.length === 0 && draft?.section !== which && (
              <div className={styles.empty}>{t('env.empty')}</div>
            )}
            {items.map((item) => (
              <Flexbox align={'center'} className={styles.item} gap={8} horizontal key={item.name}>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
                    <span className={styles.name}>{item.name}</span>
                    {(item.value ?? item.hint) && (
                      <span className={styles.valueHint}>{item.value ?? item.hint}</span>
                    )}
                    {which === 'shared' && mineNames.has(item.name) && (
                      <Tag size={'small'}>{t('env.overridden')}</Tag>
                    )}
                  </Flexbox>
                  <span className={styles.hint}>
                    {t('env.updatedAt', {
                      time: dayjs(item.updatedAt).format('YYYY-MM-DD HH:mm'),
                    })}
                  </span>
                </Flexbox>
                {editable && (
                  <Flexbox gap={4} horizontal style={{ flex: 'none' }}>
                    <Button
                      disabled={!available || busy || !!draft}
                      onClick={() =>
                        setDraft({
                          name: item.name,
                          replacing: true,
                          section: which,
                          sensitive: item.value === undefined,
                          value: item.value ?? '',
                        })
                      }
                      size={'small'}
                    >
                      {t('env.replace')}
                    </Button>
                    <Popconfirm
                      cancelText={t('env.cancel')}
                      okText={t('env.delete')}
                      onConfirm={() => run(() => onDelete(which, item.name))}
                      title={t('env.deleteConfirm', { name: item.name })}
                    >
                      <Button danger disabled={busy || !!draft} size={'small'}>
                        {t('env.delete')}
                      </Button>
                    </Popconfirm>
                  </Flexbox>
                )}
              </Flexbox>
            ))}
            {editor(which)}
          </div>
        </Flexbox>
      );
    };

    return (
      <Modal
        footer={
          <Flexbox horizontal justify={'flex-end'}>
            <Button onClick={onClose}>{t('env.close')}</Button>
          </Flexbox>
        }
        // A typed value closes only from Close or the X button.
        keyboard={!draft}
        maskClosable={!draft}
        onCancel={onClose}
        open={open}
        title={t('env.title', { name: profileName })}
        width={640}
      >
        <Flexbox gap={16}>
          <Alert message={t('env.warning')} showIcon type={'warning'} />
          <div className={styles.hint}>{t('env.replaceNote')}</div>
          {!available && <Alert message={t('env.unavailable')} showIcon type={'error'} />}
          {loadFailed && <Alert message={t('env.loadFailed')} showIcon type={'error'} />}
          {section('shared')}
          {section('mine')}
          {error && <Alert message={error} showIcon type={'error'} />}
        </Flexbox>
      </Modal>
    );
  },
);

EnvModal.displayName = 'SandboxHubEnvModal';

export default EnvModal;
