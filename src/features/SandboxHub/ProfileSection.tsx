'use client';

import type {
  SandboxHubProfileSettingsItem,
  SandboxImageStatus,
  SandboxProfileItem,
  SandboxServerHealth,
} from '@lobechat/types';
import { ActionIcon, Avatar, Button, Dropdown, Icon, Modal, Tag } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  DownloadCloud,
  MoreHorizontal,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Fragment, type ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DEFAULT_SANDBOX_PROFILE_ID } from '@/tools/sandbox/const';

import { egressSummaryKey, formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  actions: css`
    flex: none;
  `,
  card: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
  `,
  cardMain: css`
    all: unset;
    cursor: pointer;
    flex: 1;
    min-width: 0;

    &:focus-visible {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: 2px;
    }
  `,
  fact: css`
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;

    font-size: 13px;
    line-height: 1.4;
  `,
  factLabel: css`
    flex: none;
    color: ${token.colorTextDescription};
  `,
  factValue: css`
    min-width: 0;
    color: ${token.colorText};
    text-align: end;
    overflow-wrap: anywhere;
  `,
  groupDesc: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.4;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  name: css`
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  `,
  notice: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.4;
    overflow-wrap: anywhere;
  `,
  noticeError: css`
    color: ${token.colorError};
  `,
  noticeWarning: css`
    color: ${token.colorWarningText};
  `,
  summary: css`
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;

    margin-block-start: 4px;

    font-size: 12px;
    line-height: 1.4;
    color: ${token.colorTextSecondary};
  `,
}));

export interface InstructionAccess {
  /** `SANDBOX_HUB_ADMINS` lists at least one admin. */
  adminsConfigured: boolean;
  canEdit: boolean;
}

export const HEALTH_COLOR: Record<SandboxServerHealth, string> = {
  misconfigured: 'error',
  ok: 'success',
  unauthorized: 'error',
  unreachable: 'warning',
};

const IMAGE_COLOR: Record<SandboxImageStatus, string | undefined> = {
  failed: 'error',
  preparing: 'processing',
  ready: 'success',
  unknown: undefined,
};

export interface ProfileAdminProps {
  busy?: boolean;
  first: boolean;
  item: SandboxHubProfileSettingsItem;
  last: boolean;
  onDelete: () => Promise<void> | void;
  onEdit: () => void;
  onMove: (direction: 'down' | 'up') => void;
  onPrepare: () => void;
}

/** Counts for the Environment row; undefined while loading or after a failed read. */
export interface ProfileEnvSummary {
  available: boolean;
  mine: number;
  shared: number;
}

interface ProfileSectionProps {
  access?: InstructionAccess;
  /** Present for Sandbox Hub admins. */
  admin?: ProfileAdminProps;
  env?: ProfileEnvSummary;
  health?: SandboxServerHealth;
  /** Opens the environment variables dialog. */
  onOpenEnv?: () => void;
  /** Opens the instruction viewer (or editor, for admins). */
  onOpenInstruction?: () => void;
  onToggle?: (enabled: boolean) => Promise<void>;
  /** Absent for a profile users are not offered; the section then comes from `admin.item`. */
  profile?: SandboxProfileItem;
}

/** Gear and more menu for Sandbox Hub admins. */
const AdminActions = memo<ProfileAdminProps>(
  ({ busy, first, item, last, onDelete, onEdit, onMove }) => {
    const { t } = useTranslation('sandboxHub');
    const { modal } = App.useApp();

    return (
      <>
        {/* No title: a touch leaves the tooltip open, and it paints above the edit sheet. */}
        <ActionIcon
          aria-label={t('admin.settings')}
          disabled={busy}
          icon={Settings2}
          onClick={onEdit}
          size={'small'}
        />
        <Dropdown
          menu={{
            items: [
              {
                disabled: busy || first,
                icon: <Icon icon={ArrowUp} />,
                key: 'up',
                label: t('admin.moveUp'),
                onClick: () => onMove('up'),
              },
              {
                disabled: busy || last,
                icon: <Icon icon={ArrowDown} />,
                key: 'down',
                label: t('admin.moveDown'),
                onClick: () => onMove('down'),
              },
              ...(item.deletable
                ? [
                    { type: 'divider' as const },
                    {
                      danger: true,
                      disabled: busy,
                      icon: <Icon icon={Trash2} />,
                      key: 'delete',
                      label: t('admin.delete'),
                      onClick: () => {
                        modal.confirm({
                          centered: true,
                          content: t('admin.deleteConfirm', { name: item.name }),
                          okButtonProps: { danger: true },
                          okText: t('admin.delete'),
                          onOk: onDelete,
                          title: t('admin.delete'),
                          type: 'error',
                        });
                      },
                    },
                  ]
                : []),
            ],
          }}
          placement={'bottomRight'}
          trigger={['click']}
        >
          <ActionIcon aria-label={t('admin.more')} icon={MoreHorizontal} size={'small'} />
        </Dropdown>
      </>
    );
  },
);

AdminActions.displayName = 'SandboxHubAdminActions';

/**
 * One sandbox as a compact card. The summary stays on the card; the rest
 * opens in a narrow dialog. The switch and admin controls do not open it.
 */
const ProfileSection = memo<ProfileSectionProps>(
  ({ access, admin, env, health, onOpenEnv, onOpenInstruction, onToggle, profile }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);

    const name = profile?.name ?? admin?.item.name ?? '';
    const description = profile?.description ?? admin?.item.description;
    const avatar = profile?.avatar ?? admin?.item.avatar ?? undefined;

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

    const toggle = async (enabled: boolean) => {
      if (!onToggle) return;
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

    // Problems show on the card, under the description.
    const notices: { message: string; type: 'error' | 'warning' }[] = [];
    if (failed) notices.push({ message: t('profile.toggleFailed'), type: 'error' });
    if (admin?.item.issue) {
      notices.push({ message: t('admin.issue', { issue: admin.item.issue }), type: 'warning' });
    } else if (profile && !profile.available) {
      notices.push({ message: t('profile.unavailable'), type: 'warning' });
    }

    const idle = profile ? timeLabel(profile.sessionIdleTimeoutMs) : undefined;
    const maxLifetime = profile ? timeLabel(profile.sessionMaxLifetimeMs) : undefined;
    const preparing = admin?.item.imageStatus === 'preparing';
    const imageStatusTime = admin?.item.imageStatusUpdatedAt
      ? dayjs(admin.item.imageStatusUpdatedAt).format('YYYY-MM-DD HH:mm')
      : undefined;
    const imageNote = admin
      ? [admin.item.imageStatusMessage, imageStatusTime].filter(Boolean).join(' · ')
      : '';

    const summary: ReactNode[] = [
      ...(profile
        ? [
            t('profile.resources', { cpu: profile.cpu, memory: profile.memory }),
            t(egressSummaryKey(profile.egress), {
              count: profile.egress.mode === 'allowlist' ? profile.egress.targets.length : 0,
            }),
            idle ? t('profile.idle', { time: idle }) : t('profile.idlePerCall'),
            ...(profile.serverName ? [profile.serverName] : []),
          ]
        : []),
      ...(env && !env.available ? [t('env.unavailable')] : []),
      ...(admin
        ? [
            <Tag color={IMAGE_COLOR[admin.item.imageStatus]} key={'image'} size={'small'}>
              {t(`admin.image.${admin.item.imageStatus}`)}
            </Tag>,
          ]
        : []),
    ];

    const fact = (label: string, value: ReactNode) => (
      <div className={styles.fact} key={label}>
        <span className={styles.factLabel}>{label}</span>
        <span className={styles.factValue}>{value}</span>
      </div>
    );

    const closeAnd = (action?: () => void) => {
      setDetailsOpen(false);
      action?.();
    };

    return (
      <>
        <Flexbox align={'flex-start'} className={styles.card} gap={8} horizontal>
          <button
            aria-label={t('profile.details', { name })}
            className={styles.cardMain}
            onClick={() => setDetailsOpen(true)}
            type={'button'}
          >
            <Flexbox gap={2}>
              <Flexbox align={'center'} gap={8} horizontal>
                {avatar && <Avatar avatar={avatar} size={24} style={{ flex: 'none' }} />}
                <span className={styles.name}>{name}</span>
                {!profile && admin && (
                  <Tag color={'warning'} size={'small'}>
                    {t('admin.notOfferedTag')}
                  </Tag>
                )}
              </Flexbox>
              {description && <span className={styles.groupDesc}>{description}</span>}
              {notices.map(({ message, type }) => (
                <Flexbox
                  align={'center'}
                  className={`${styles.notice} ${type === 'error' ? styles.noticeError : styles.noticeWarning}`}
                  gap={4}
                  horizontal
                  key={message}
                >
                  <Icon icon={AlertTriangle} size={12} />
                  <span>{message}</span>
                </Flexbox>
              ))}
              {summary.length > 0 && (
                <div className={styles.summary}>
                  {summary.map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 && ' · '}
                      {typeof part === 'string' ? <span>{part}</span> : part}
                    </Fragment>
                  ))}
                </div>
              )}
            </Flexbox>
          </button>
          <Flexbox align={'center'} className={styles.actions} gap={4} horizontal>
            {admin && <AdminActions {...admin} />}
            {profile && onToggle && (
              <Switch
                aria-label={t('profile.toggle', { name: profile.name })}
                checked={profile.enabled}
                disabled={!profile.available && !profile.enabled}
                loading={pending}
                onChange={(checked) => void toggle(checked)}
              />
            )}
          </Flexbox>
        </Flexbox>
        <Modal
          footer={null}
          onCancel={() => setDetailsOpen(false)}
          open={detailsOpen}
          title={name}
          width={440}
        >
          <Flexbox gap={10}>
            {profile && (
              <>
                {fact(
                  t('profile.rows.resources'),
                  t('profile.resources', { cpu: profile.cpu, memory: profile.memory }),
                )}
                {fact(
                  t('profile.rows.network'),
                  <>
                    {t(egressSummaryKey(profile.egress), {
                      count:
                        profile.egress.mode === 'allowlist' ? profile.egress.targets.length : 0,
                    })}
                    {profile.egress.mode === 'allowlist' && (
                      <div className={styles.groupDesc}>
                        {t('profile.egressTargets', { targets: profile.egress.targets.join(', ') })}
                      </div>
                    )}
                  </>,
                )}
                {fact(
                  t('profile.rows.lifetime'),
                  [
                    idle ? t('profile.idle', { time: idle }) : t('profile.idlePerCall'),
                    maxLifetime ? t('profile.maxLifetime', { time: maxLifetime }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                )}
                {fact(
                  t('profile.rows.server'),
                  <>
                    {profile.serverName}
                    {health && (
                      <>
                        {' '}
                        <Tag color={HEALTH_COLOR[health]} size={'small'}>
                          {t(`health.${health}`)}
                        </Tag>
                      </>
                    )}
                  </>,
                )}
                {!(profile.id === DEFAULT_SANDBOX_PROFILE_ID && access?.canEdit) &&
                  fact(
                    t('profile.rows.instruction'),
                    <Flexbox align={'center'} gap={8} horizontal justify={'flex-end'} wrap={'wrap'}>
                      {profile.instructionCustomized && (
                        <Tag color={'processing'} size={'small'}>
                          {t('profile.instruction.customized')}
                        </Tag>
                      )}
                      {profile.instructionUpdatedAt && (
                        <span className={styles.groupDesc}>
                          {t('profile.instruction.updatedAt', {
                            time: dayjs(profile.instructionUpdatedAt).format('YYYY-MM-DD HH:mm'),
                          })}
                        </span>
                      )}
                      <Button onClick={() => closeAnd(onOpenInstruction)} size={'small'}>
                        {access?.canEdit
                          ? t('profile.instruction.edit')
                          : t('profile.instruction.view')}
                      </Button>
                    </Flexbox>,
                  )}
                {onOpenEnv &&
                  fact(
                    t('env.row'),
                    <Flexbox align={'center'} gap={8} horizontal justify={'flex-end'}>
                      <span>
                        {env && !env.available
                          ? t('env.unavailable')
                          : env
                            ? t('env.summary', { mine: env.mine, shared: env.shared })
                            : ''}
                      </span>
                      <Button onClick={() => closeAnd(onOpenEnv)} size={'small'}>
                        {t('env.manage')}
                      </Button>
                    </Flexbox>,
                  )}
              </>
            )}
            {admin &&
              fact(
                t('profile.rows.image'),
                <Flexbox align={'center'} gap={8} horizontal justify={'flex-end'} wrap={'wrap'}>
                  <Tag color={IMAGE_COLOR[admin.item.imageStatus]} size={'small'}>
                    {t(`admin.image.${admin.item.imageStatus}`)}
                  </Tag>
                  {imageNote && <span className={styles.groupDesc}>{imageNote}</span>}
                  <Button
                    disabled={admin.busy || preparing}
                    icon={DownloadCloud}
                    loading={preparing}
                    onClick={() => closeAnd(admin.onPrepare)}
                    size={'small'}
                  >
                    {t('admin.prepare')}
                  </Button>
                </Flexbox>,
              )}
          </Flexbox>
        </Modal>
      </>
    );
  },
);

ProfileSection.displayName = 'SandboxHubProfileSection';

export default ProfileSection;
