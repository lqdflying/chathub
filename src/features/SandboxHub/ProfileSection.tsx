'use client';

import type {
  SandboxHubProfileSettingsItem,
  SandboxImageStatus,
  SandboxProfileItem,
  SandboxServerHealth,
} from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Button,
  Dropdown,
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Icon,
  Tag,
} from '@lobehub/ui';
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
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';

import { egressSummaryKey, formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  groupDesc: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.5;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  name: css`
    min-width: 0;
    overflow-wrap: anywhere;
  `,
  notice: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.5;
    overflow-wrap: anywhere;
  `,
  noticeError: css`
    color: ${token.colorError};
  `,
  noticeWarning: css`
    color: ${token.colorWarningText};
  `,
  value: css`
    min-width: 0;
    color: ${token.colorTextSecondary};
    text-align: end;
    overflow-wrap: anywhere;
  `,
}));

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

interface ProfileSectionProps {
  access?: InstructionAccess;
  /** Present for Sandbox Hub admins. */
  admin?: ProfileAdminProps;
  health?: SandboxServerHealth;
  /** Opens the instruction viewer (or editor, for admins). */
  onOpenInstruction?: () => void;
  onToggle?: (enabled: boolean) => Promise<void>;
  /** Absent for a profile users are not offered; the section then comes from `admin.item`. */
  profile?: SandboxProfileItem;
}

/** Settings and order controls for admins, kept out of the group's collapse click. */
const AdminActions = memo<ProfileAdminProps>(
  ({ busy, first, item, last, onDelete, onEdit, onMove }) => {
    const { t } = useTranslation('sandboxHub');
    const { modal } = App.useApp();

    return (
      <>
        <ActionIcon
          disabled={busy}
          icon={Settings2}
          onClick={onEdit}
          size={'small'}
          title={t('admin.settings')}
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
          <ActionIcon icon={MoreHorizontal} size={'small'} title={t('admin.more')} />
        </Dropdown>
      </>
    );
  },
);

AdminActions.displayName = 'SandboxHubAdminActions';

/**
 * One sandbox as a Settings group: name and description in the header, the
 * on/off switch and admin controls on the right, and one row per setting.
 */
const ProfileSection = memo<ProfileSectionProps>(
  ({ access, admin, health, onOpenInstruction, onToggle, profile }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);

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

    const value = (text: string | undefined) => <span className={styles.value}>{text}</span>;

    // Problems show in the group header, under the description.
    const notices: { message: string; type: 'error' | 'warning' }[] = [];
    if (failed) notices.push({ message: t('profile.toggleFailed'), type: 'error' });
    if (admin?.item.issue) {
      notices.push({ message: t('admin.issue', { issue: admin.item.issue }), type: 'warning' });
    } else if (profile && !profile.available) {
      notices.push({ message: t('profile.unavailable'), type: 'warning' });
    }

    const rows: FormItemProps[] = [];

    if (profile) {
      const idle = timeLabel(profile.sessionIdleTimeoutMs);
      const maxLifetime = timeLabel(profile.sessionMaxLifetimeMs);
      rows.push(
        {
          children: value(t('profile.resources', { cpu: profile.cpu, memory: profile.memory })),
          desc: t('profile.rows.resourcesDesc'),
          label: t('profile.rows.resources'),
          minWidth: undefined,
        },
        {
          children: value(
            t(egressSummaryKey(profile.egress), {
              count: profile.egress.mode === 'allowlist' ? profile.egress.targets.length : 0,
            }),
          ),
          desc:
            profile.egress.mode === 'allowlist'
              ? t('profile.egressTargets', { targets: profile.egress.targets.join(', ') })
              : t('profile.rows.networkDesc'),
          label: t('profile.rows.network'),
          minWidth: undefined,
        },
        {
          children: value(
            [
              idle ? t('profile.idle', { time: idle }) : t('profile.idlePerCall'),
              maxLifetime ? t('profile.maxLifetime', { time: maxLifetime }) : '',
            ]
              .filter(Boolean)
              .join(' · '),
          ),
          desc: t('profile.rows.lifetimeDesc'),
          label: t('profile.rows.lifetime'),
          minWidth: undefined,
        },
        {
          children: (
            <Flexbox align={'center'} gap={8} horizontal justify={'flex-end'}>
              {value(profile.serverName)}
              {health && (
                <Tag color={HEALTH_COLOR[health]} size={'small'}>
                  {t(`health.${health}`)}
                </Tag>
              )}
            </Flexbox>
          ),
          desc: t('profile.rows.serverDesc'),
          label: t('profile.rows.server'),
          minWidth: undefined,
        },
        {
          children: (
            <Button onClick={onOpenInstruction} size={'small'}>
              {access?.canEdit ? t('profile.instruction.edit') : t('profile.instruction.view')}
            </Button>
          ),
          desc: profile.instructionCustomized ? (
            <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
              <Tag color={'processing'} size={'small'}>
                {t('profile.instruction.customized')}
              </Tag>
              {profile.instructionUpdatedAt &&
                t('profile.instruction.updatedAt', {
                  time: dayjs(profile.instructionUpdatedAt).format('YYYY-MM-DD HH:mm'),
                })}
            </Flexbox>
          ) : (
            t('profile.rows.instructionDesc')
          ),
          label: t('profile.rows.instruction'),
          minWidth: undefined,
        },
      );
    }

    if (admin) {
      const { item } = admin;
      const preparing = item.imageStatus === 'preparing';
      const statusTime = item.imageStatusUpdatedAt
        ? dayjs(item.imageStatusUpdatedAt).format('YYYY-MM-DD HH:mm')
        : undefined;
      rows.push({
        children: (
          <Flexbox align={'center'} gap={8} horizontal justify={'flex-end'}>
            <Tag color={IMAGE_COLOR[item.imageStatus]} size={'small'}>
              {t(`admin.image.${item.imageStatus}`)}
            </Tag>
            <Button
              disabled={admin.busy || preparing}
              icon={DownloadCloud}
              loading={preparing}
              onClick={admin.onPrepare}
              size={'small'}
            >
              {t('admin.prepare')}
            </Button>
          </Flexbox>
        ),
        desc:
          [item.imageStatusMessage, statusTime].filter(Boolean).join(' · ') ||
          t('profile.rows.imageDesc'),
        label: t('profile.rows.image'),
        minWidth: undefined,
      });
    }

    const group: FormGroupItemType = {
      children: rows,
      defaultActive: true,
      extra: (
        // The header toggles the group open and closed; its controls must not.
        <Flexbox align={'center'} gap={4} horizontal onClick={(event) => event.stopPropagation()}>
          {admin && <AdminActions {...admin} />}
          {profile && onToggle && (
            <Switch
              aria-label={t('profile.toggle', { name: profile.name })}
              checked={profile.enabled}
              disabled={!profile.available && !profile.enabled}
              loading={pending}
              onChange={(checked) => void toggle(checked)}
              style={{ marginInlineStart: 8 }}
            />
          )}
        </Flexbox>
      ),
      key: profile?.id ?? admin?.item.id,
      // Form does not show a group's `desc`, so the description is the title's second line.
      title: (
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Flexbox align={'center'} gap={8} horizontal style={{ minWidth: 0 }}>
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
        </Flexbox>
      ),
    };

    return <Form items={[group]} itemsType={'group'} variant={'borderless'} {...FORM_STYLE} />;
  },
);

ProfileSection.displayName = 'SandboxHubProfileSection';

export default ProfileSection;
