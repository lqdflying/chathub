'use client';

import { Button, Icon, Tooltip } from '@lobehub/ui';
import { Progress, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { CircleHelpIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { lambdaQuery } from '@/libs/trpc/client';
import {
  captureSensitiveAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import {
  CODEX_HELP_TOOLTIP_MAX_WIDTH,
  clampCodexUsagePercent,
  formatCodexPlanLabel,
  getCoarsePointerServerSnapshot,
  getCoarsePointerSnapshot,
  resolveCodexHelpTrigger,
  resolveCodexUsageStroke,
  subscribeCoarsePointer,
} from '../openai/openaiCodexStatus';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  code: css`
    margin-block: 8px;
    min-width: 0;
    overflow-wrap: anywhere;

    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.16em;
  `,
  email: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorText};
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
  `,
  helpButton: css`
    cursor: help;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    padding: 0;
    border: 0;
    background: transparent;
    color: ${token.colorTextDescription};

    &:hover,
    &:focus-visible {
      color: ${token.colorText};
    }
  `,
  helpText: css`
    max-width: 100%;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 12px;
    line-height: 1.55;
    white-space: normal;
  `,
  hint: css`
    min-width: 0;
    overflow-wrap: anywhere;

    color: ${token.colorTextSecondary};
    font-size: 12px;
    line-height: 1.6;
  `,
  identity: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  meter: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    min-width: 0;
  `,
  meterHeading: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  meterLabel: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorText};
    font-size: 13px;
    font-weight: 500;
  `,
  meterReset: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.4;
  `,
  meterValue: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
  planTag: css`
    max-width: 100%;
    min-width: 0;
    height: auto;
    overflow-wrap: anywhere;
    white-space: normal !important;
    line-height: 1.4;
  `,
  session: css`
    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.4;
  `,
  statusRow: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;

    width: 100%;
    max-width: 100%;
    min-width: 0;
  `,
  title: css`
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 14px;
    font-weight: 600;
  `,
  titleRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
}));

const STATUS_STALE_MS = 30_000;

const formatUsageReset = (iso?: string) => (iso ? new Date(iso).toLocaleString() : undefined);

const XaiOAuthSignIn = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('modelProvider');
  const updateXaiOAuthConnected = useAiInfraStore((s) => s.updateXaiOAuthConnected);
  const userStateScope = useUserStore((s) => s.userStateScope);
  const preferenceOwner = useUserStore(authSelectors.currentUserScope);
  const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isLogin = useUserStore(authSelectors.isLogin);
  const canFetch =
    !!isLogin &&
    !!userStateScope &&
    !!preferenceOwner &&
    userStateScope === preferenceOwner &&
    isUserStateInit &&
    !hasOwnerMismatch;
  const statusQuery = lambdaQuery.xaiOAuth.status.useQuery(
    { accountScope: userStateScope ?? '' },
    { enabled: canFetch, staleTime: STATUS_STALE_MS },
  );
  const startLogin = lambdaQuery.xaiOAuth.startDeviceLogin.useMutation();
  const pollLogin = lambdaQuery.xaiOAuth.pollDeviceLogin.useMutation();
  const logout = lambdaQuery.xaiOAuth.logout.useMutation();
  const [userCode, setUserCode] = useState<string>();
  const [verificationUrl, setVerificationUrl] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string>();
  const loginGeneration = useRef(0);
  const pollTimer = useRef<number | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  const invalidateDeviceLogin = useCallback(() => {
    loginGeneration.current += 1;
    stopPolling();
  }, [stopPolling]);

  const resetDeviceLogin = useCallback(() => {
    invalidateDeviceLogin();
    setWaiting(false);
    setUserCode(undefined);
    setVerificationUrl(undefined);
    setError(undefined);
  }, [invalidateDeviceLogin]);

  useEffect(() => () => invalidateDeviceLogin(), [invalidateDeviceLogin]);

  useEffect(() => {
    resetDeviceLogin();
    updateXaiOAuthConnected(false);
  }, [resetDeviceLogin, updateXaiOAuthConnected, userStateScope]);

  useEffect(() => {
    if (!canFetch) {
      updateXaiOAuthConnected(false);
      return;
    }
    if (statusQuery.data) updateXaiOAuthConnected(!!statusQuery.data.connected);
  }, [canFetch, statusQuery.data, updateXaiOAuthConnected]);

  const startDeviceLogin = async () => {
    const snapshot = captureSensitiveAccountMutationSnapshot(useUserStore.getState());
    if (!snapshot) return;

    invalidateDeviceLogin();
    const generation = loginGeneration.current;
    const isCurrentAttempt = () =>
      loginGeneration.current === generation &&
      isAccountMutationCurrent(useUserStore.getState(), snapshot);

    setError(undefined);
    let started: Awaited<ReturnType<typeof startLogin.mutateAsync>>;
    try {
      started = await startLogin.mutateAsync({ accountScope: snapshot.scope });
    } catch {
      if (!isCurrentAttempt()) return;
      setError(t('xaiOAuth.denied'));
      return;
    }
    if (!isCurrentAttempt()) return;
    setUserCode(started.userCode);
    setVerificationUrl(started.verificationUrl);
    setWaiting(true);

    const expiresAtMs = Date.parse(started.expiresAt);
    const schedulePoll = (delayMs: number) => {
      stopPolling();
      if (!isCurrentAttempt()) return;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || delayMs <= 0) {
        setWaiting(false);
        setUserCode(undefined);
        setVerificationUrl(undefined);
        setError(t('xaiOAuth.expired'));
        updateXaiOAuthConnected(false);
        return;
      }

      pollTimer.current = window.setTimeout(() => {
        void (async () => {
          if (!isCurrentAttempt()) {
            stopPolling();
            return;
          }
          try {
            const result = await pollLogin.mutateAsync({
              accountScope: snapshot.scope,
              handoffId: started.handoffId,
            });
            if (!isCurrentAttempt()) return;
            if (result.status === 'pending') {
              schedulePoll(result.nextDelayMs || result.intervalMs);
              return;
            }

            stopPolling();
            setWaiting(false);
            setUserCode(undefined);
            setVerificationUrl(undefined);

            if (result.status === 'connected') {
              updateXaiOAuthConnected(true);
              await statusQuery.refetch();
              return;
            }

            setError(result.status === 'expired' ? t('xaiOAuth.expired') : t('xaiOAuth.denied'));
            updateXaiOAuthConnected(false);
          } catch {
            if (!isCurrentAttempt()) return;
            schedulePoll(started.intervalMs);
          }
        })();
      }, delayMs);
    };

    schedulePoll(started.intervalMs);
  };

  const handleLogout = async () => {
    const snapshot = captureSensitiveAccountMutationSnapshot(useUserStore.getState());
    if (!snapshot) return;
    invalidateDeviceLogin();
    await logout.mutateAsync({ accountScope: snapshot.scope });
    if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) return;
    updateXaiOAuthConnected(false);
    await statusQuery.refetch();
  };

  const coarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    getCoarsePointerServerSnapshot,
  );
  const helpTrigger = resolveCodexHelpTrigger(coarsePointer);
  const connected = canFetch && !!statusQuery.data?.connected;
  const fiveHourReported = typeof statusQuery.data?.fiveHour?.remainingPercent === 'number';
  const weeklyReported = typeof statusQuery.data?.weekly?.remainingPercent === 'number';
  const fiveHourPercent = fiveHourReported
    ? clampCodexUsagePercent(statusQuery.data?.fiveHour?.remainingPercent)
    : undefined;
  const weeklyPercent = weeklyReported
    ? clampCodexUsagePercent(statusQuery.data?.weekly?.remainingPercent)
    : undefined;
  const fiveHourReset = formatUsageReset(statusQuery.data?.fiveHour?.resetsAt);
  const weeklyReset = formatUsageReset(statusQuery.data?.weekly?.resetsAt);
  const planLabel = formatCodexPlanLabel(statusQuery.data?.plan);
  const weeklyTitle =
    statusQuery.data?.weekly?.label === 'Monthly' ? t('xaiOAuth.monthlyTitle') : t('xaiOAuth.weeklyTitle');
  const helpTitle = (
    <Flexbox gap={8}>
      <p className={styles.helpText}>{t('xaiOAuth.hint')}</p>
      <p className={styles.helpText}>{t('xaiOAuth.deviceLoginPrerequisite')}</p>
      <p className={styles.helpText}>{t('xaiOAuth.unofficial')}</p>
    </Flexbox>
  );

  return (
    <Flexbox className={styles.card} gap={12}>
      <div className={styles.titleRow}>
        <div className={styles.title}>{t('xaiOAuth.title')}</div>
        <Tooltip
          styles={{ root: { boxSizing: 'border-box', maxWidth: CODEX_HELP_TOOLTIP_MAX_WIDTH } }}
          title={helpTitle}
          trigger={helpTrigger}
        >
          <button aria-label={t('xaiOAuth.helpAria')} className={styles.helpButton} type="button">
            <Icon icon={CircleHelpIcon} size={14} />
          </button>
        </Tooltip>
      </div>

      {connected ? (
        <div className={styles.statusRow}>
          <div className={styles.identity}>
            <div className={styles.email}>
              {statusQuery.data?.email
                ? t('xaiOAuth.connected', { email: statusQuery.data.email })
                : t('xaiOAuth.connectedAnonymous')}
            </div>
            {planLabel && (
              <Tag bordered={false} className={styles.planTag} color="processing">
                {t('xaiOAuth.connectedPlan', { plan: planLabel })}
              </Tag>
            )}
          </div>
          {statusQuery.data?.fiveHour && (
            <div className={styles.meter}>
              <div className={styles.meterHeading}>
                <span className={styles.meterLabel}>{t('xaiOAuth.fiveHourTitle')}</span>
                {fiveHourPercent !== undefined && (
                  <span className={styles.meterValue}>
                    {t('xaiOAuth.remainingPercent', { percent: fiveHourPercent })}
                  </span>
                )}
              </div>
              {fiveHourPercent !== undefined ? (
                <Progress
                  aria-label={t('xaiOAuth.fiveHourLeft', { percent: fiveHourPercent })}
                  percent={fiveHourPercent}
                  showInfo={false}
                  size="small"
                  status={resolveCodexUsageStroke(fiveHourPercent)}
                />
              ) : (
                <div className={styles.meterReset}>{t('xaiOAuth.usageUnavailable')}</div>
              )}
              {fiveHourReset && (
                <div className={styles.meterReset}>
                  {t('xaiOAuth.usageResets', { time: fiveHourReset })}
                </div>
              )}
            </div>
          )}
          {statusQuery.data?.weekly && (
            <div className={styles.meter}>
              <div className={styles.meterHeading}>
                <span className={styles.meterLabel}>{weeklyTitle}</span>
                {weeklyPercent !== undefined && (
                  <span className={styles.meterValue}>
                    {t('xaiOAuth.remainingPercent', { percent: weeklyPercent })}
                  </span>
                )}
              </div>
              {weeklyPercent !== undefined ? (
                <Progress
                  aria-label={t('xaiOAuth.weeklyLeft', { percent: weeklyPercent })}
                  percent={weeklyPercent}
                  showInfo={false}
                  size="small"
                  status={resolveCodexUsageStroke(weeklyPercent)}
                />
              ) : (
                <div className={styles.meterReset}>{t('xaiOAuth.usageUnavailable')}</div>
              )}
              {weeklyReset && (
                <div className={styles.meterReset}>
                  {t('xaiOAuth.usageResets', { time: weeklyReset })}
                </div>
              )}
            </div>
          )}
          {connected && !statusQuery.data?.fiveHour && !statusQuery.data?.weekly && (
            <div className={styles.hint}>{t('xaiOAuth.usageUnavailable')}</div>
          )}
          {statusQuery.data?.expiresAt && (
            <div className={styles.session}>
              {t('xaiOAuth.expires', {
                time: new Date(statusQuery.data.expiresAt).toLocaleString(),
              })}
            </div>
          )}
          <div>
            <Button loading={logout.isPending} onClick={handleLogout}>
              {t('xaiOAuth.signOut')}
            </Button>
          </div>
        </div>
      ) : waiting && userCode ? (
        <>
          <div className={styles.hint}>{t('xaiOAuth.waiting')}</div>
          <div className={styles.code}>{userCode}</div>
          {verificationUrl && (
            <Button
              onClick={() => window.open(verificationUrl, '_blank', 'noopener,noreferrer')}
              type={'primary'}
            >
              {t('xaiOAuth.openGrok')}
            </Button>
          )}
        </>
      ) : (
        <Button
          disabled={!canFetch}
          loading={startLogin.isPending}
          onClick={() => void startDeviceLogin()}
          type={'primary'}
        >
          {t('xaiOAuth.signIn')}
        </Button>
      )}

      {error && <div className={styles.hint}>{error}</div>}
    </Flexbox>
  );
};

export default XaiOAuthSignIn;
