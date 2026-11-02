'use client';

import type { SandboxHubProfileSettingsItem, SandboxImageStatus } from '@lobechat/types';
import { Button, Popconfirm, Tag } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  bar: css`
    padding-top: 10px;
    border-top: 1px dashed ${token.colorBorderSecondary};
  `,
  issue: css`
    color: ${token.colorWarningText};
    font-size: 12px;
    overflow-wrap: anywhere;
  `,
  status: css`
    min-width: 0;
    font-size: 12px;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  tag: css`
    margin: 0;
  `,
}));

const STATUS_COLOR: Record<SandboxImageStatus, string | undefined> = {
  failed: 'error',
  preparing: 'processing',
  ready: 'success',
  unknown: undefined,
};

interface ProfileAdminBarProps {
  busy?: boolean;
  first: boolean;
  item: SandboxHubProfileSettingsItem;
  last: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (direction: 'down' | 'up') => void;
  onPrepare: () => void;
}

/** Admin controls under a Sandbox Hub profile: settings, order, image, delete. */
const ProfileAdminBar = memo<ProfileAdminBarProps>(
  ({ busy, first, item, last, onDelete, onEdit, onMove, onPrepare }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('sandboxHub');
    const preparing = item.imageStatus === 'preparing';
    const statusTime = item.imageStatusUpdatedAt
      ? dayjs(item.imageStatusUpdatedAt).format('YYYY-MM-DD HH:mm')
      : undefined;

    return (
      <Flexbox className={styles.bar} gap={8}>
        {item.issue && (
          <div className={styles.issue}>{t('admin.issue', { issue: item.issue })}</div>
        )}
        <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
          <Button disabled={busy} onClick={onEdit} size={'small'}>
            {t('admin.settings')}
          </Button>
          <Button
            aria-label={t('admin.moveUp')}
            disabled={busy || first}
            onClick={() => onMove('up')}
            size={'small'}
          >
            ↑
          </Button>
          <Button
            aria-label={t('admin.moveDown')}
            disabled={busy || last}
            onClick={() => onMove('down')}
            size={'small'}
          >
            ↓
          </Button>
          <Button
            disabled={busy || preparing}
            loading={preparing}
            onClick={onPrepare}
            size={'small'}
          >
            {t('admin.prepare')}
          </Button>
          <Tag bordered={false} className={styles.tag} color={STATUS_COLOR[item.imageStatus]}>
            {t(`admin.image.${item.imageStatus}`)}
          </Tag>
          {(item.imageStatusMessage || statusTime) && (
            <span className={styles.status}>
              {[item.imageStatusMessage, statusTime].filter(Boolean).join(' · ')}
            </span>
          )}
          {item.deletable && (
            <Popconfirm
              cancelText={t('admin.form.cancel')}
              okText={t('admin.delete')}
              onConfirm={onDelete}
              title={t('admin.deleteConfirm', { name: item.name })}
            >
              <Button danger disabled={busy} size={'small'}>
                {t('admin.delete')}
              </Button>
            </Popconfirm>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

ProfileAdminBar.displayName = 'SandboxHubProfileAdminBar';

export default ProfileAdminBar;
