'use client';

import type { SandboxFileItem } from '@lobechat/types';
import { Alert, Button, Modal, Tag } from '@lobehub/ui';
import { Checkbox, Input, Popconfirm, Upload } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { Plus, Upload as UploadIcon, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import type { SandboxFileWriteInput } from '@/services/sandboxHub';
import {
  SANDBOX_FILE_DEFAULT_MODE,
  SANDBOX_FILE_MAX_BYTES,
  SANDBOX_FILE_MODE_PATTERN,
  SANDBOX_FILE_MODE_PRESETS,
  sandboxFilePathProblem,
} from '@/tools/sandbox/const';

import type { EnvSection } from './EnvModal';

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
  path: css`
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    overflow-wrap: anywhere;
  `,
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
  `,
  text: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
  `,
}));

interface Draft {
  /** A chosen local file, already read. */
  chosen?: { bytes: Uint8Array; name: string };
  mode: string;
  path: string;
  /** Replacing a saved file: its path is fixed and empty content keeps the old one. */
  replacing: boolean;
  section: EnvSection;
  sensitive: boolean;
  /** Pasted text, used when no file is chosen. */
  text: string;
}

interface FilesModalProps {
  /** The server can encrypt content (KEY_VAULTS_SECRET is set). */
  available: boolean;
  canEditShared: boolean;
  entry?: { mine: SandboxFileItem[]; shared: SandboxFileItem[] };
  loadFailed?: boolean;
  onClose: () => void;
  onDelete: (section: EnvSection, path: string) => Promise<void>;
  onSave: (section: EnvSection, file: SandboxFileWriteInput) => Promise<void>;
  open: boolean;
  profileName: string;
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x80_00) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x80_00));
  }
  return btoa(binary);
};

export const formatFileSize = (size: number) =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

/**
 * A profile's secret files: the shared ones (admins edit, everyone sees paths)
 * and the user's own. Content is chosen or pasted here and sent once; the
 * server returns it only for a file that is not sensitive.
 */
const FilesModal = memo<FilesModalProps>(
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
      // Drop chosen or pasted content as soon as the dialog closes.
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

    const content = draft?.chosen?.bytes ?? new TextEncoder().encode(draft?.text ?? '');
    const pathProblem = (() => {
      if (!draft || draft.replacing || !draft.path) return undefined;
      const problem = sandboxFilePathProblem(draft.path);
      if (problem === 'format') return t('files.invalidPath');
      if (problem === 'blocked') return t('files.blockedPath');
      return undefined;
    })();
    const modeProblem =
      !!draft && !SANDBOX_FILE_MODE_PATTERN.test(draft.mode) ? t('files.invalidMode') : undefined;
    const tooLarge = content.byteLength > SANDBOX_FILE_MAX_BYTES;
    const hasContent = content.byteLength > 0;
    const canSave =
      !!draft &&
      !busy &&
      !!draft.path &&
      (hasContent || draft.replacing) &&
      !pathProblem &&
      !modeProblem &&
      !tooLarge;

    const mineByPath = new Set(entry?.mine.map((item) => item.path));

    const save = (section: EnvSection, current: Draft) =>
      run(
        () =>
          onSave(section, {
            ...(hasContent ? { content: toBase64(content) } : {}),
            mode: current.mode,
            path: current.path,
            sensitive: current.sensitive,
          }),
        () => setDraft(undefined),
      );

    const choose = async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setDraft((current) =>
        current ? { ...current, chosen: { bytes, name: file.name } } : current,
      );
    };

    const editor = (section: EnvSection) => {
      if (draft?.section !== section) return null;
      return (
        <Flexbox className={styles.editor} gap={8}>
          <Input
            aria-label={t('files.path')}
            className={styles.code}
            disabled={draft.replacing}
            onChange={(event) => setDraft({ ...draft, path: event.target.value.trim() })}
            placeholder={'/root/.oci/config'}
            value={draft.path}
          />
          <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
            <span className={styles.hint}>{t('files.mode')}</span>
            <Input
              aria-label={t('files.mode')}
              className={styles.code}
              maxLength={3}
              onChange={(event) => setDraft({ ...draft, mode: event.target.value.trim() })}
              style={{ width: 72 }}
              value={draft.mode}
            />
            {SANDBOX_FILE_MODE_PRESETS.map((mode) => (
              <Button
                key={mode}
                onClick={() => setDraft({ ...draft, mode })}
                size={'small'}
                type={draft.mode === mode ? 'primary' : 'default'}
              >
                {mode}
              </Button>
            ))}
          </Flexbox>
          {draft.chosen ? (
            <Flexbox align={'center'} gap={8} horizontal>
              <span className={styles.path}>
                {t('files.chosen', {
                  name: draft.chosen.name,
                  size: formatFileSize(draft.chosen.bytes.byteLength),
                })}
              </span>
              <Button
                icon={X}
                onClick={() => setDraft({ ...draft, chosen: undefined })}
                size={'small'}
              >
                {t('files.clear')}
              </Button>
            </Flexbox>
          ) : (
            <>
              <Input.TextArea
                aria-label={t('files.content')}
                autoSize={{ maxRows: 12, minRows: 4 }}
                className={styles.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                placeholder={
                  draft.replacing && draft.sensitive
                    ? t('files.contentKeepPlaceholder')
                    : t('files.contentPlaceholder')
                }
                spellCheck={false}
                value={draft.text}
              />
              <Upload
                beforeUpload={(file) => {
                  void choose(file);
                  return false;
                }}
                maxCount={1}
                showUploadList={false}
              >
                <Button icon={UploadIcon} size={'small'}>
                  {t('files.choose')}
                </Button>
              </Upload>
            </>
          )}
          <Checkbox
            checked={draft.sensitive}
            onChange={(event) => setDraft({ ...draft, sensitive: event.target.checked })}
          >
            {t('files.sensitive')}
          </Checkbox>
          {pathProblem && <div className={styles.error}>{pathProblem}</div>}
          {modeProblem && <div className={styles.error}>{modeProblem}</div>}
          {tooLarge && (
            <div className={styles.error}>
              {t('files.tooLarge', { max: SANDBOX_FILE_MAX_BYTES / 1024 })}
            </div>
          )}
          <Flexbox gap={8} horizontal justify={'flex-end'}>
            <Button disabled={busy} onClick={() => setDraft(undefined)} size={'small'}>
              {t('files.cancel')}
            </Button>
            <Button
              disabled={!canSave}
              loading={busy}
              onClick={() => void save(section, draft)}
              size={'small'}
              type={'primary'}
            >
              {t('files.save')}
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
          ? t('files.mineHint')
          : canEditShared
            ? t('files.sharedHint')
            : t('files.sharedReadOnly');
      return (
        <Flexbox gap={4}>
          <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <span className={styles.sectionTitle}>{t(`files.${which}`)}</span>
              <span className={styles.hint}>{hint}</span>
            </Flexbox>
            {editable && (
              <Button
                disabled={!available || busy || !!draft}
                icon={Plus}
                onClick={() =>
                  setDraft({
                    mode: SANDBOX_FILE_DEFAULT_MODE,
                    path: '',
                    replacing: false,
                    section: which,
                    sensitive: true,
                    text: '',
                  })
                }
                size={'small'}
                style={{ flex: 'none' }}
              >
                {t('files.add')}
              </Button>
            )}
          </Flexbox>
          <div>
            {items.length === 0 && draft?.section !== which && (
              <div className={styles.empty}>{t('files.empty')}</div>
            )}
            {items.map((item) => (
              <Flexbox align={'center'} className={styles.item} gap={8} horizontal key={item.path}>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
                    <span className={styles.path}>{item.path}</span>
                    <Tag size={'small'}>{item.mode}</Tag>
                    {!item.sensitive && <Tag size={'small'}>{t('files.notSensitive')}</Tag>}
                    {which === 'shared' && mineByPath.has(item.path) && (
                      <Tag size={'small'}>{t('files.overridden')}</Tag>
                    )}
                  </Flexbox>
                  <span className={styles.hint}>
                    {t('files.meta', {
                      size: formatFileSize(item.size),
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
                          mode: item.mode,
                          path: item.path,
                          replacing: true,
                          section: which,
                          sensitive: item.sensitive,
                          text: item.content ?? '',
                        })
                      }
                      size={'small'}
                    >
                      {t('files.replace')}
                    </Button>
                    <Popconfirm
                      cancelText={t('files.cancel')}
                      okText={t('files.delete')}
                      onConfirm={() => run(() => onDelete(which, item.path))}
                      title={t('files.deleteConfirm', { path: item.path })}
                    >
                      <Button danger disabled={busy || !!draft} size={'small'}>
                        {t('files.delete')}
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
            <Button onClick={onClose}>{t('files.close')}</Button>
          </Flexbox>
        }
        // Chosen or pasted content closes only from Close or the X button.
        keyboard={!draft}
        maskClosable={!draft}
        onCancel={onClose}
        open={open}
        title={t('files.title', { name: profileName })}
        width={640}
      >
        <Flexbox gap={16}>
          <Alert message={t('files.warning')} showIcon type={'warning'} />
          <div className={styles.hint}>{t('files.replaceNote')}</div>
          {!available && <Alert message={t('files.unavailable')} showIcon type={'error'} />}
          {loadFailed && <Alert message={t('files.loadFailed')} showIcon type={'error'} />}
          {section('shared')}
          {section('mine')}
          {error && <Alert message={error} showIcon type={'error'} />}
        </Flexbox>
      </Modal>
    );
  },
);

FilesModal.displayName = 'SandboxHubFilesModal';

export default FilesModal;
