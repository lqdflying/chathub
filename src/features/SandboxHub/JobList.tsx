'use client';

import type {
  SandboxHubJobList,
  SandboxJobItem,
  SandboxJobStatus,
  SandboxProfileItem,
} from '@lobechat/types';
import { ActionIcon, Button, Icon, Tag } from '@lobehub/ui';
import { Popconfirm } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

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
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
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

const emptyJobs = (): SandboxHubJobList => ({
  finished: { items: [], page: 1, pageSize: 20, total: 0 },
  running: [],
});

/**
 * This user's background jobs: running ones, then finished ones 20 per page
 * with Purge. Cancel for running ones. Hidden until there is one.
 */
const JobList = memo<JobListProps>(({ profiles, scope }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const [jobs, setJobs] = useState<SandboxHubJobList>(emptyJobs);
  const [page, setPage] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string>();
  const [cancelFailed, setCancelFailed] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeFailed, setPurgeFailed] = useState(false);

  const load = useCallback(
    async (nextPage: number) => {
      setRefreshing(true);
      try {
        const next = await sandboxHubService.listHubJobs(scope, nextPage);
        setJobs(next);
        setPage(next.finished.page);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      } finally {
        setRefreshing(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const cancel = async (jobId: string) => {
    setCancelling(jobId);
    setCancelFailed(false);
    try {
      await sandboxHubService.cancelJob(scope, jobId);
      await load(page);
    } catch {
      setCancelFailed(true);
    } finally {
      setCancelling(undefined);
    }
  };

  const purge = async () => {
    setPurging(true);
    setPurgeFailed(false);
    try {
      await sandboxHubService.purgeFinishedJobs(scope);
      await load(1);
    } catch {
      setPurgeFailed(true);
    } finally {
      setPurging(false);
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

  const { finished, running } = jobs;
  if (!loadFailed && running.length === 0 && finished.total === 0) return null;

  const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;
  const notices = [
    ...(loadFailed ? [t('jobs.loadFailed')] : []),
    ...(cancelFailed ? [t('jobs.cancelFailed')] : []),
    ...(purgeFailed ? [t('jobs.purgeFailed')] : []),
  ];
  const pages = Math.max(1, Math.ceil(finished.total / finished.pageSize));

  const row = (job: SandboxJobItem) => {
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
    return (
      <Flexbox gap={4} key={job.id} style={{ minWidth: 0, width: '100%' }}>
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
    );
  };

  return (
    <Flexbox gap={16}>
      <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
        <Flexbox gap={2}>
          <span className={styles.sectionTitle}>{t('jobs.title')}</span>
          <span className={styles.groupDesc}>{t('jobs.description')}</span>
          {notices.map((message) => (
            <Flexbox align={'center'} className={styles.notice} gap={4} horizontal key={message}>
              <Icon icon={AlertTriangle} size={12} />
              <span>{message}</span>
            </Flexbox>
          ))}
        </Flexbox>
        <ActionIcon
          aria-label={t('jobs.refresh')}
          icon={RefreshCw}
          loading={refreshing}
          onClick={() => {
            void load(page);
          }}
          size={'small'}
          title={t('jobs.refresh')}
        />
      </Flexbox>
      {running.length > 0 && (
        <Flexbox gap={8}>
          <span className={styles.sectionTitle}>{t('jobs.running')}</span>
          {running.map(row)}
        </Flexbox>
      )}
      {finished.total > 0 && (
        <Flexbox gap={8}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <span className={styles.sectionTitle}>{t('jobs.finished')}</span>
            <Popconfirm
              cancelText={t('profile.instruction.cancel')}
              okText={t('jobs.purge')}
              onConfirm={() => void purge()}
              title={t('jobs.purgeConfirm')}
            >
              <Button loading={purging} size={'small'}>
                {t('jobs.purge')}
              </Button>
            </Popconfirm>
          </Flexbox>
          {finished.items.map(row)}
          {pages > 1 && (
            <Flexbox align={'center'} gap={8} horizontal>
              <Button disabled={page <= 1} onClick={() => void load(page - 1)} size={'small'}>
                {t('jobs.previous')}
              </Button>
              <span className={styles.meta}>{t('jobs.page', { page, pages })}</span>
              <Button disabled={page >= pages} onClick={() => void load(page + 1)} size={'small'}>
                {t('jobs.next')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

JobList.displayName = 'SandboxHubJobList';

export default JobList;
