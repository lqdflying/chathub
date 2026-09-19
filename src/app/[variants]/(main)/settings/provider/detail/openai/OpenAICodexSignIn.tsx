'use client';

import { Button } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    { enabled: canFetch },
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

  const connected = canFetch && !!statusQuery.data?.connected;

  return (
    <Flexbox className={styles.card} gap={8}>
      <div className={styles.title}>{t('openaiCodex.title')}</div>
      <div className={styles.hint}>{t('openaiCodex.hint')}</div>
      <div className={styles.hint}>{t('openaiCodex.deviceLoginPrerequisite')}</div>
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
