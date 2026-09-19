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
} from './openaiCodexStatus';

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
  /* Status copy above Sign out so overflow-x hidden cannot park the action
     off the right edge. Connectivity Check is a one-row
     minmax(0, 1fr) auto grid; this card stays stacked because the status
     text is a full-width paragraph, not a shrinking select.
     @see https://developer.mozilla.org/en-US/docs/Web/CSS/min-width
     @see https://stackoverflow.com/questions/36230944/prevent-flex-items-from-overflowing-a-container */
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

const POLL_INTERVAL_MS = 2500;
const STATUS_STALE_MS = 30_000;

const formatUsageReset = (iso?: string) =>
  iso ? new Date(iso).toLocaleString() : undefined;

const OpenAICodexSignIn = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('modelProvider');
  const updateOpenAICodexConnected = useAiInfraStore((s) => s.updateOpenAICodexConnected);
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
  const statusQuery = lambdaQuery.openaiCodex.status.useQuery(
    { accountScope: userStateScope ?? '' },
    { enabled: canFetch, staleTime: STATUS_STALE_MS },
  );
  const startLogin = lambdaQuery.openaiCodex.startDeviceLogin.useMutation();
  const pollLogin = lambdaQuery.openaiCodex.pollDeviceLogin.useMutation();
  const logout = lambdaQuery.openaiCodex.logout.useMutation();
  const [userCode, setUserCode] = useState<string>();
  const [verificationUrl, setVerificationUrl] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string>();
  const pollTimer = useRef<number | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  const resetDeviceLogin = useCallback(() => {
    stopPolling();
    setWaiting(false);
    setUserCode(undefined);
    setVerificationUrl(undefined);
    setError(undefined);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    resetDeviceLogin();
    updateOpenAICodexConnected(false);
  }, [resetDeviceLogin, updateOpenAICodexConnected, userStateScope]);

  useEffect(() => {
    if (!canFetch) {
      updateOpenAICodexConnected(false);
      return;
    }
    if (statusQuery.data) updateOpenAICodexConnected(!!statusQuery.data.connected);
  }, [canFetch, statusQuery.data, updateOpenAICodexConnected]);

  const startDeviceLogin = async () => {
    const snapshot = captureSensitiveAccountMutationSnapshot(useUserStore.getState());
    if (!snapshot) return;

    setError(undefined);
    let started: Awaited<ReturnType<typeof startLogin.mutateAsync>>;
    try {
      started = await startLogin.mutateAsync({ accountScope: snapshot.scope });
    } catch {
      if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) return;
      setError(t('openaiCodex.denied'));
      return;
    }
    if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) return;
    setUserCode(started.userCode);
    setVerificationUrl(started.verificationUrl);
    setWaiting(true);

    stopPolling();
    pollTimer.current = window.setInterval(() => {
      void (async () => {
        if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) {
          stopPolling();
          return;
        }
        try {
          const result = await pollLogin.mutateAsync({
            accountScope: snapshot.scope,
            handoffId: started.handoffId,
          });
          if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) return;
          if (result.status === 'pending') return;

          stopPolling();
          setWaiting(false);
          setUserCode(undefined);
          setVerificationUrl(undefined);

          if (result.status === 'connected') {
            updateOpenAICodexConnected(true);
            await statusQuery.refetch();
            return;
          }

          setError(result.status === 'expired' ? t('openaiCodex.expired') : t('openaiCodex.denied'));
          updateOpenAICodexConnected(false);
        } catch {
          // Keep polling until the handoff expires or the user starts again.
        }
      })();
    }, POLL_INTERVAL_MS);
  };

  const handleLogout = async () => {
    const snapshot = captureSensitiveAccountMutationSnapshot(useUserStore.getState());
    if (!snapshot) return;
    stopPolling();
    await logout.mutateAsync({ accountScope: snapshot.scope });
    if (!isAccountMutationCurrent(useUserStore.getState(), snapshot)) return;
    updateOpenAICodexConnected(false);
    await statusQuery.refetch();
  };

  const coarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    getCoarsePointerServerSnapshot,
  );
  const helpTrigger = resolveCodexHelpTrigger(coarsePointer);
  const connected = canFetch && !!statusQuery.data?.connected;
  const fiveHourPercent = clampCodexUsagePercent(statusQuery.data?.fiveHour?.remainingPercent);
  const weeklyPercent = clampCodexUsagePercent(statusQuery.data?.weekly?.remainingPercent);
  const fiveHourReset = formatUsageReset(statusQuery.data?.fiveHour?.resetsAt);
  const weeklyReset = formatUsageReset(statusQuery.data?.weekly?.resetsAt);
  const planLabel = formatCodexPlanLabel(statusQuery.data?.chatgptPlanType);
  const helpTitle = (
    <Flexbox gap={8}>
      <p className={styles.helpText}>{t('openaiCodex.hint')}</p>
      <p className={styles.helpText}>{t('openaiCodex.deviceLoginPrerequisite')}</p>
      <p className={styles.helpText}>{t('openaiCodex.unofficial')}</p>
    </Flexbox>
  );

  return (
    <Flexbox className={styles.card} gap={12}>
      <div className={styles.titleRow}>
        <div className={styles.title}>{t('openaiCodex.title')}</div>
        <Tooltip
          styles={{ root: { boxSizing: 'border-box', maxWidth: CODEX_HELP_TOOLTIP_MAX_WIDTH } }}
          title={helpTitle}
          trigger={helpTrigger}
        >
          <button
            aria-label={t('openaiCodex.helpAria')}
            className={styles.helpButton}
            type="button"
          >
            <Icon icon={CircleHelpIcon} size={14} />
          </button>
        </Tooltip>
      </div>

      {connected ? (
        <div className={styles.statusRow}>
          <div className={styles.identity}>
            <div className={styles.email}>
              {statusQuery.data?.email
                ? t('openaiCodex.connected', { email: statusQuery.data.email })
                : t('openaiCodex.connectedAnonymous')}
            </div>
            {planLabel && (
              <Tag bordered={false} className={styles.planTag} color="processing">
                {t('openaiCodex.connectedPlan', { plan: planLabel })}
              </Tag>
            )}
          </div>
          {statusQuery.data?.fiveHour && (
            <div className={styles.meter}>
              <div className={styles.meterHeading}>
                <span className={styles.meterLabel}>{t('openaiCodex.fiveHourTitle')}</span>
                <span className={styles.meterValue}>
                  {t('openaiCodex.remainingPercent', { percent: fiveHourPercent })}
                </span>
              </div>
              <Progress
                aria-label={t('openaiCodex.fiveHourLeft', { percent: fiveHourPercent })}
                percent={fiveHourPercent}
                showInfo={false}
                size="small"
                status={resolveCodexUsageStroke(fiveHourPercent)}
              />
              {fiveHourReset && (
                <div className={styles.meterReset}>
                  {t('openaiCodex.usageResets', { time: fiveHourReset })}
                </div>
              )}
            </div>
          )}
          {statusQuery.data?.weekly && (
            <div className={styles.meter}>
              <div className={styles.meterHeading}>
                <span className={styles.meterLabel}>{t('openaiCodex.weeklyTitle')}</span>
                <span className={styles.meterValue}>
                  {t('openaiCodex.remainingPercent', { percent: weeklyPercent })}
                </span>
              </div>
              <Progress
                aria-label={t('openaiCodex.weeklyLeft', { percent: weeklyPercent })}
                percent={weeklyPercent}
                showInfo={false}
                size="small"
                status={resolveCodexUsageStroke(weeklyPercent)}
              />
              {weeklyReset && (
                <div className={styles.meterReset}>
                  {t('openaiCodex.usageResets', { time: weeklyReset })}
                </div>
              )}
            </div>
          )}
          {statusQuery.data?.expiresAt && (
            <div className={styles.session}>
              {t('openaiCodex.expires', {
                time: new Date(statusQuery.data.expiresAt).toLocaleString(),
              })}
            </div>
          )}
          <div>
            <Button loading={logout.isPending} onClick={handleLogout}>
              {t('openaiCodex.signOut')}
            </Button>
          </div>
        </div>
      ) : waiting && userCode ? (
        <>
          <div className={styles.hint}>{t('openaiCodex.waiting')}</div>
          <div className={styles.code}>{userCode}</div>
          {verificationUrl && (
            <Button
              onClick={() => window.open(verificationUrl, '_blank', 'noopener,noreferrer')}
              type={'primary'}
            >
              {t('openaiCodex.openChatGPT')}
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
          {t('openaiCodex.signIn')}
        </Button>
      )}

      {error && <div className={styles.hint}>{error}</div>}
    </Flexbox>
  );
};

export default OpenAICodexSignIn;
