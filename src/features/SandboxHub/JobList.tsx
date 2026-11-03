'use client';

import type { SandboxJobItem, SandboxJobStatus, SandboxProfileItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Icon,
  Tag,
} from '@lobehub/ui';
import { Popconfirm } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { sandboxHubService } from '@/services/sandboxHub';

import { formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  command: css`
    flex: 1;
    min-width: 0;

    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  `,
  groupDesc: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.5;
    color: ${token.colorTextDescription};
  `,
  meta: css`
    min-width: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextDescription};
    overflow-wrap: anywhere;
  `,
  notice: css`
    font-size: 12px;
    font-weight: normal;
    line-height: 1.5;
    color: ${token.colorError};
  `,
}));

const STATUS_COLOR: Record<SandboxJobStatus, string | undefined> = {
  cancelled: undefined,
  failed: 'error',
  lost: 'error',
  running: 'processing',
  succeeded: 'success',
  timed_out: 'warning',
};

interface JobListProps {
  profiles: SandboxProfileItem[];
  scope: string;
}

/**
 * The user's recent background jobs as a Settings group, with Cancel for
 * running ones. Hidden until there is one.
 */
const JobList = memo<JobListProps>(({ profiles, scope }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const [jobs, setJobs] = useState<SandboxJobItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string>();
  const [cancelFailed, setCancelFailed] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await sandboxHubService.listJobs(scope);
      setJobs(next);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (jobId: string) => {
    setCancelling(jobId);
    setCancelFailed(false);
    try {
      setJobs(await sandboxHubService.cancelJob(scope, jobId));
    } catch {
      setCancelFailed(true);
    } finally {
      setCancelling(undefined);
    }
  };

  const durationLabel = (job: SandboxJobItem) => {
    const end = job.finishedAt ? dayjs(job.finishedAt) : dayjs();
    const parts = formatDuration(end.diff(dayjs(job.startedAt)));
    if (!parts) return undefined;
    return [
      parts.hours ? t('profile.duration.hours', { count: parts.hours }) : '',
      parts.minutes ? t('profile.duration.minutes', { count: parts.minutes }) : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  if (!loadFailed && jobs.length === 0) return null;

  const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;
  // Problems show in the group header, under the description.
  const notices = [
    ...(loadFailed ? [t('jobs.loadFailed')] : []),
    ...(cancelFailed ? [t('jobs.cancelFailed')] : []),
  ];

  const rows: FormItemProps[] = jobs.map((job): FormItemProps => {
    const duration = durationLabel(job);
    const meta = [
      profileName(job.profileId),
      t('jobs.startedAt', { time: dayjs(job.startedAt).format('YYYY-MM-DD HH:mm') }),
      duration ? t('jobs.duration', { time: duration }) : '',
      job.exitCode === undefined ? '' : t('jobs.exitCode', { code: job.exitCode }),
      job.id,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      // Full-width content. A command in the label column is clipped by the
      // nowrap Settings row and the page's overflow-x.
      children: (
        <Flexbox gap={4} style={{ minWidth: 0, width: '100%' }}>
          <Flexbox align={'flex-start'} gap={8} horizontal style={{ minWidth: 0 }}>
            <span className={styles.command}>{job.command}</span>
            <Flexbox align={'center'} gap={8} horizontal style={{ flex: 'none' }}>
              <Tag color={STATUS_COLOR[job.status]} size={'small'}>
                {t(`jobs.status.${job.status}`)}
              </Tag>
              {job.status === 'running' && (
                <Popconfirm
                  cancelText={t('profile.instruction.cancel')}
                  okText={t('jobs.cancel')}
                  onConfirm={() => cancel(job.id)}
                  title={t('jobs.cancelConfirm')}
                >
                  <Button loading={cancelling === job.id} size={'small'}>
                    {t('jobs.cancel')}
                  </Button>
                </Popconfirm>
              )}
            </Flexbox>
          </Flexbox>
          <span className={styles.meta}>{meta}</span>
        </Flexbox>
      ),
      layout: 'vertical',
      minWidth: undefined,
    };
  });

  const group: FormGroupItemType = {
    children: rows,
    defaultActive: true,
    extra: (
      <ActionIcon
        aria-label={t('jobs.refresh')}
        icon={RefreshCw}
        loading={refreshing}
        onClick={() => {
          void load();
        }}
        size={'small'}
        title={t('jobs.refresh')}
      />
    ),
    // Form does not show a group's `desc`, so the description is the title's second line.
    title: (
      <Flexbox gap={2}>
        <span>{t('jobs.title')}</span>
        <span className={styles.groupDesc}>{t('jobs.description')}</span>
        {notices.map((message) => (
          <Flexbox align={'center'} className={styles.notice} gap={4} horizontal key={message}>
            <Icon icon={AlertTriangle} size={12} />
            <span>{message}</span>
          </Flexbox>
        ))}
      </Flexbox>
    ),
  };

  return <Form items={[group]} itemsType={'group'} variant={'borderless'} {...FORM_STYLE} />;
});

JobList.displayName = 'SandboxHubJobList';

export default JobList;
