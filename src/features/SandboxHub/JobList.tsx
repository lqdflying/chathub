'use client';

import type { SandboxJobItem, SandboxJobStatus, SandboxProfileItem } from '@lobechat/types';
import { Button, Popconfirm, Tag } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { sandboxHubService } from '@/services/sandboxHub';

import { formatDuration } from './format';

const useStyles = createStyles(({ css, token }) => ({
  command: css`
    min-width: 0;
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    overflow-wrap: anywhere;
  `,
  hint: css`
    color: ${token.colorTextSecondary};
    font-size: 13px;
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: ${token.colorTextDescription};
  `,
  row: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};
  `,
  tag: css`
    margin: 0;
  `,
  title: css`
    margin: 0;
    font-size: 16px;
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

/** The user's recent background jobs, with Cancel for running ones. Hidden until there is one. */
const JobList = memo<JobListProps>(({ profiles, scope }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('sandboxHub');
  const [jobs, setJobs] = useState<SandboxJobItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cancelling, setCancelling] = useState<string>();
  const [cancelFailed, setCancelFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await sandboxHubService.listJobs(scope);
      setJobs(next);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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

  return (
    <Flexbox gap={8}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
        <h2 className={styles.title}>{t('jobs.title')}</h2>
        <Button onClick={() => void load()} size={'small'} type={'text'}>
          {t('jobs.refresh')}
        </Button>
      </Flexbox>
      <div className={styles.hint}>{t('jobs.description')}</div>
      {loadFailed && <div className={styles.hint}>{t('jobs.loadFailed')}</div>}
      {cancelFailed && <div className={styles.hint}>{t('jobs.cancelFailed')}</div>}

      {jobs.map((job) => {
        const duration = durationLabel(job);
        return (
          <Flexbox className={styles.row} gap={6} key={job.id}>
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <Flexbox align={'center'} gap={8} horizontal style={{ minWidth: 0 }}>
                <Tag bordered={false} className={styles.tag} color={STATUS_COLOR[job.status]}>
                  {t(`jobs.status.${job.status}`)}
                </Tag>
                <span className={styles.command}>{job.command}</span>
              </Flexbox>
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
            <div className={styles.meta}>
              <span>{profileName(job.profileId)}</span>
              <span>
                {t('jobs.startedAt', { time: dayjs(job.startedAt).format('YYYY-MM-DD HH:mm') })}
              </span>
              {duration && <span>{t('jobs.duration', { time: duration })}</span>}
              {job.exitCode !== undefined && (
                <span>{t('jobs.exitCode', { code: job.exitCode })}</span>
              )}
              <span>{job.id}</span>
            </div>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

JobList.displayName = 'SandboxHubJobList';

export default JobList;
