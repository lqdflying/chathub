'use client';

import { Button } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  code: css`
    margin-block: 8px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.16em;
  `,
  hint: css`
    color: ${token.colorTextSecondary};
    font-size: 12px;
    line-height: 1.6;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
  `,
}));

const POLL_INTERVAL_MS = 2500;

const OpenAICodexSignIn = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('modelProvider');
  const updateOpenAICodexConnected = useAiInfraStore((s) => s.updateOpenAICodexConnected);
  const statusQuery = lambdaQuery.openaiCodex.status.useQuery();
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

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    updateOpenAICodexConnected(!!statusQuery.data?.connected);
  }, [statusQuery.data?.connected, updateOpenAICodexConnected]);

  const startDeviceLogin = async () => {
    setError(undefined);
    let started: Awaited<ReturnType<typeof startLogin.mutateAsync>>;
    try {
      started = await startLogin.mutateAsync();
    } catch {
      setError(t('openaiCodex.denied'));
      return;
    }
    setUserCode(started.userCode);
    setVerificationUrl(started.verificationUrl);
    setWaiting(true);

    stopPolling();
    pollTimer.current = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollLogin.mutateAsync({ handoffId: started.handoffId });
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
    stopPolling();
    await logout.mutateAsync();
    updateOpenAICodexConnected(false);
    await statusQuery.refetch();
  };

  const connected = !!statusQuery.data?.connected;

  return (
    <Flexbox className={styles.card} gap={8}>
      <div className={styles.title}>{t('openaiCodex.title')}</div>
      <div className={styles.hint}>{t('openaiCodex.hint')}</div>
      <div className={styles.hint}>{t('openaiCodex.unofficial')}</div>

      {connected ? (
        <>
          <div>
            {statusQuery.data?.email
              ? t('openaiCodex.connected', { email: statusQuery.data.email })
              : t('openaiCodex.connectedAnonymous')}
          </div>
          {statusQuery.data?.chatgptPlanType && (
            <div className={styles.hint}>
              {t('openaiCodex.connectedPlan', { plan: statusQuery.data.chatgptPlanType })}
            </div>
          )}
          {statusQuery.data?.expiresAt && (
            <div className={styles.hint}>
              {t('openaiCodex.expires', {
                time: new Date(statusQuery.data.expiresAt).toLocaleString(),
              })}
            </div>
          )}
          <Button loading={logout.isPending} onClick={handleLogout}>
            {t('openaiCodex.signOut')}
          </Button>
        </>
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
