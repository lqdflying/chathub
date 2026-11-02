'use client';

import type { SandboxProfileItem, SandboxServerHealth } from '@lobechat/types';
import { Avatar } from '@lobehub/ui';
import { Button, Input, Popconfirm, Switch, Tag } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { type ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { SANDBOX_INSTRUCTION_MAX_BYTES } from '@/tools/sandbox/const';

import { egressSummaryKey, formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  description: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.6;
  `,
  editor: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
  `,
  error: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorError};
    font-size: 13px;
    line-height: 1.6;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  `,
  instruction: css`
    overflow: auto;

    max-height: 320px;
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
  link: css`
    cursor: pointer;

    padding: 0;
    border: 0;

    font-size: 12px;
    color: ${token.colorLink};

    background: transparent;
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;

    min-width: 0;

    font-size: 12px;
    color: ${token.colorTextDescription};
  `,
  name: css`
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  `,
  tag: css`
    margin: 0;
  `,
  warning: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorWarningText};
    font-size: 13px;
    line-height: 1.6;
  `,
}));

/** `{{name}}` is filled in by the chat template step before the model sees it. */
const PLACEHOLDER = /{{\s*[\w.-]+\s*}}/;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export interface InstructionAccess {
  /** `SANDBOX_HUB_ADMINS` lists at least one admin. */
  adminsConfigured: boolean;
  canEdit: boolean;
}

const HEALTH_COLOR: Record<SandboxServerHealth, string> = {
  misconfigured: 'error',
  ok: 'success',
  unauthorized: 'error',
  unreachable: 'warning',
};

interface ProfileCardProps {
  /** Undefined until the Hub knows whether this user may edit instructions. */
  access?: InstructionAccess;
  /** Shown at the bottom of the card (Sandbox Hub admin controls). */
  footer?: ReactNode;
  health?: SandboxServerHealth;
  onResetInstruction: () => Promise<void>;
  onSaveInstruction: (instruction: string) => Promise<void>;
  onToggle: (enabled: boolean) => Promise<void>;
  profile: SandboxProfileItem;
}

const ProfileCard = memo<ProfileCardProps>((props) => {
  const { access, footer, health, onResetInstruction, onSaveInstruction, onToggle, profile } =
    props;
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showInstruction, setShowInstruction] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [instructionFailed, setInstructionFailed] = useState(false);

  const canEdit = !!access?.canEdit;
  const editing = draft !== undefined;
  const draftBytes = editing ? byteLength(draft) : 0;
  const tooLarge = draftBytes > SANDBOX_INSTRUCTION_MAX_BYTES;
  const canSave =
    editing && !saving && !tooLarge && draft.trim().length > 0 && draft !== profile.instruction;

  const timeLabel = (ms: number) => {
    const parts = formatDuration(ms);
    if (!parts) return undefined;
    return [
      parts.hours ? t('profile.duration.hours', { count: parts.hours }) : '',
      parts.minutes ? t('profile.duration.minutes', { count: parts.minutes }) : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const idle = timeLabel(profile.sessionIdleTimeoutMs);
  const maxLifetime = timeLabel(profile.sessionMaxLifetimeMs);
  const egressTargets =
    profile.egress.mode === 'allowlist' ? profile.egress.targets.join(', ') : undefined;

  const startEdit = () => {
    setInstructionFailed(false);
    setShowInstruction(true);
    setDraft(profile.instruction);
  };

  const runInstructionChange = async (change: () => Promise<void>) => {
    setSaving(true);
    setInstructionFailed(false);
    try {
      await change();
      setDraft(undefined);
    } catch {
      setInstructionFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (enabled: boolean) => {
    setPending(true);
    setFailed(false);
    try {
      await onToggle(enabled);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Flexbox className={styles.card} gap={12}>
      <div className={styles.header}>
        <Flexbox align={'center'} gap={12} horizontal style={{ minWidth: 0 }}>
          {profile.avatar && <Avatar avatar={profile.avatar} size={36} style={{ flex: 'none' }} />}
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <div className={styles.name}>{profile.name}</div>
            <div className={styles.description}>{profile.description}</div>
          </Flexbox>
        </Flexbox>
        <Switch
          aria-label={t('profile.toggle', { name: profile.name })}
          checked={profile.enabled}
          disabled={!profile.available && !profile.enabled}
          loading={pending}
          onChange={(checked) => void toggle(checked)}
        />
      </div>

      <div className={styles.meta}>
        <span>{t('profile.resources', { cpu: profile.cpu, memory: profile.memory })}</span>
        <span>
          {t(egressSummaryKey(profile.egress), {
            count: profile.egress.mode === 'allowlist' ? profile.egress.targets.length : 0,
          })}
        </span>
        <span>
          {idle ? t('profile.idle', { time: idle }) : t('profile.idlePerCall')}
          {maxLifetime ? ` · ${t('profile.maxLifetime', { time: maxLifetime })}` : ''}
        </span>
        <span>
          {t('profile.server', { name: profile.serverName })}{' '}
          {health && (
            <Tag bordered={false} className={styles.tag} color={HEALTH_COLOR[health]}>
              {t(`health.${health}`)}
            </Tag>
          )}
        </span>
      </div>

      {egressTargets && (
        <div className={styles.meta}>{t('profile.egressTargets', { targets: egressTargets })}</div>
      )}

      {!profile.available && <div className={styles.description}>{t('profile.unavailable')}</div>}
      {failed && <div className={styles.description}>{t('profile.toggleFailed')}</div>}

      <Flexbox align={'center'} gap={12} horizontal style={{ minWidth: 0 }} wrap={'wrap'}>
        {!editing && (
          <button
            className={styles.link}
            onClick={() => setShowInstruction((value) => !value)}
            type="button"
          >
            {showInstruction ? t('profile.hideInstruction') : t('profile.showInstruction')}
          </button>
        )}
        {canEdit && !editing && (
          <button className={styles.link} onClick={startEdit} type="button">
            {t('profile.instruction.edit')}
          </button>
        )}
        {canEdit && !editing && profile.instructionCustomized && (
          <Popconfirm
            cancelText={t('profile.instruction.cancel')}
            okText={t('profile.instruction.reset')}
            onConfirm={() => runInstructionChange(onResetInstruction)}
            title={t('profile.instruction.resetConfirm')}
          >
            <button className={styles.link} disabled={saving} type="button">
              {t('profile.instruction.reset')}
            </button>
          </Popconfirm>
        )}
        {profile.instructionCustomized && (
          <span className={styles.meta}>
            <Tag bordered={false} className={styles.tag} color={'processing'}>
              {t('profile.instruction.customized')}
            </Tag>
            {profile.instructionUpdatedAt &&
              t('profile.instruction.updatedAt', {
                time: dayjs(profile.instructionUpdatedAt).format('YYYY-MM-DD HH:mm'),
              })}
          </span>
        )}
      </Flexbox>

      {showInstruction && !editing && (
        <pre className={styles.instruction}>{profile.instruction}</pre>
      )}

      {editing && (
        <Flexbox gap={8}>
          <div className={styles.description}>{t('profile.instruction.editHint')}</div>
          <Input.TextArea
            aria-label={t('profile.instruction.editLabel', { name: profile.name })}
            autoSize={{ maxRows: 24, minRows: 8 }}
            className={styles.editor}
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <div className={styles.meta}>
            {t('profile.instruction.size', {
              max: SANDBOX_INSTRUCTION_MAX_BYTES / 1024,
              size: (draftBytes / 1024).toFixed(1),
            })}
          </div>
          {tooLarge && (
            <div className={styles.error}>
              {t('profile.instruction.tooLarge', { max: SANDBOX_INSTRUCTION_MAX_BYTES / 1024 })}
            </div>
          )}
          {PLACEHOLDER.test(draft) && (
            <div className={styles.warning}>
              {t('profile.instruction.placeholderWarning', { example: '{{date}}' })}
            </div>
          )}
          <Flexbox gap={8} horizontal justify={'flex-end'}>
            <Button disabled={saving} onClick={() => setDraft(undefined)} size={'small'}>
              {t('profile.instruction.cancel')}
            </Button>
            <Button
              disabled={!canSave}
              loading={saving}
              onClick={() => runInstructionChange(() => onSaveInstruction(draft))}
              size={'small'}
              type={'primary'}
            >
              {t('profile.instruction.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      {instructionFailed && (
        <div className={styles.error}>{t('profile.instruction.saveFailed')}</div>
      )}
      {showInstruction && access && !access.canEdit && (
        <div className={styles.description}>
          {access.adminsConfigured
            ? t('profile.instruction.readOnly')
            : t('profile.instruction.readOnlyNoAdmins')}
        </div>
      )}
      {footer}
    </Flexbox>
  );
});

ProfileCard.displayName = 'SandboxHubProfileCard';

export default ProfileCard;
