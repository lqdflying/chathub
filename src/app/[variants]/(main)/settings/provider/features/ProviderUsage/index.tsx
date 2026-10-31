'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { Progress, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { RefreshCwIcon } from 'lucide-react';
import { forwardRef, memo, useCallback, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { isProviderUsageAdminProvider } from '@/const/providerUsage';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import AdminKeyForm from './AdminKeyForm';
import {
  PROVIDER_USAGE_STALE_MS,
  formatUsageCount,
  formatUsageMoney,
  formatUsageTime,
  resolveUsageStroke,
  usageWindowTitleKey,
} from './format';

const useStyles = createStyles(({ css, token }) => ({
  amount: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorText};
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  `,
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
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  hint: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    line-height: 1.6;
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: center;

    min-width: 0;

    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.4;
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
  meterValue: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
  sub: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorTextDescription};
    font-size: 12px;
    line-height: 1.4;
  `,
  tag: css`
    max-width: 100%;
    min-width: 0;
    height: auto;
    margin: 0;
    overflow-wrap: anywhere;
    white-space: normal !important;
    line-height: 1.4;
  `,
  title: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: center;

    min-width: 0;

    font-size: 14px;
    font-weight: 600;
  `,
  warning: css`
    min-width: 0;
    overflow-wrap: anywhere;
    color: ${token.colorWarningText};
    font-size: 12px;
    line-height: 1.6;
  `,
}));

export interface ProviderUsageCardRef {
  refresh: () => Promise<void>;
}

interface ProviderUsageCardProps {
  provider: string;
}

const ProviderUsageCard = memo(
  forwardRef<ProviderUsageCardRef, ProviderUsageCardProps>(({ provider }, ref) => {
    const { styles } = useStyles();
    const { t } = useTranslation('modelProvider');
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

    const input = { accountScope: userStateScope ?? '', provider };
    const utils = lambdaQuery.useUtils();
    const usageQuery = lambdaQuery.providerUsage.get.useQuery(input, {
      enabled: canFetch,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: PROVIDER_USAGE_STALE_MS,
    });
    const refreshMutation = lambdaQuery.providerUsage.refresh.useMutation();

    const refresh = useCallback(async () => {
      if (!canFetch) return;
      try {
        const next = await refreshMutation.mutateAsync(input);
        utils.providerUsage.get.setData(input, next);
      } catch {
        // The card already renders the last snapshot; a failed refresh is silent.
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFetch, provider, userStateScope]);

    useImperativeHandle(ref, () => ({ refresh }), [refresh]);

    const snapshot = usageQuery.data;
    const loading = usageQuery.isLoading && canFetch;
    const refreshing = refreshMutation.isPending;

    const keyHint = snapshot?.keyHint;
    const sourceText =
      keyHint && snapshot?.credentialSource === 'server'
        ? t('providerUsage.sourceServer', { hint: keyHint })
        : keyHint
          ? t('providerUsage.sourceUser', { hint: keyHint })
          : undefined;

    const isAdmin = isProviderUsageAdminProvider(provider);
    const statusHint = (() => {
      if (!snapshot || snapshot.status === 'ok') return undefined;
      if (snapshot.reason) return t(`providerUsage.reason.${snapshot.reason}`);
      // The admin form below explains what is missing.
      if (isAdmin && snapshot.status === 'noCredential') return undefined;
      return t(`providerUsage.status.${snapshot.status}`);
    })();

    const hasData =
      !!snapshot?.balances?.length || !!snapshot?.windows?.length || !!snapshot?.spend;

    // `null` means the server has no reader for this provider.
    if (snapshot === null) return null;

    return (
      <Flexbox className={styles.card} gap={12}>
        <div className={styles.header}>
          <div className={styles.title}>
            <span>{t('providerUsage.title')}</span>
            {snapshot?.unofficial && (
              <Tooltip title={t('providerUsage.unofficialHint')}>
                <Tag bordered={false} className={styles.tag} color="warning">
                  {t('providerUsage.unofficial')}
                </Tag>
              </Tooltip>
            )}
          </div>
          <ActionIcon
            disabled={!canFetch}
            icon={RefreshCwIcon}
            loading={refreshing}
            onClick={() => void refresh()}
            size={'small'}
            title={t('providerUsage.refresh')}
          />
        </div>

        {(sourceText || snapshot?.plan) && (
          <div className={styles.meta}>
            {sourceText && <span>{sourceText}</span>}
            {snapshot?.plan && (
              <Tag bordered={false} className={styles.tag} color="processing">
                {t('providerUsage.plan', { plan: snapshot.plan })}
              </Tag>
            )}
          </div>
        )}

        {loading && <div className={styles.hint}>{t('providerUsage.loading')}</div>}

        {snapshot?.balances?.map((balance) => (
          <Flexbox gap={2} key={balance.currency}>
            <div className={styles.sub}>{t('providerUsage.balance')}</div>
            <div className={styles.amount}>{formatUsageMoney(balance.total, balance.currency)}</div>
            {(balance.granted !== undefined || balance.paid !== undefined) && (
              <div className={styles.sub}>
                {t('providerUsage.balanceBreakdown', {
                  granted: formatUsageMoney(balance.granted ?? 0, balance.currency),
                  paid: formatUsageMoney(balance.paid ?? 0, balance.currency),
                })}
              </div>
            )}
          </Flexbox>
        ))}

        {snapshot?.isAvailable === false && (
          <div className={styles.warning}>{t('providerUsage.insufficient')}</div>
        )}

        {snapshot?.spend && (
          <Flexbox gap={2}>
            <div className={styles.sub}>{t('providerUsage.spendTitle')}</div>
            <div className={styles.amount}>
              {formatUsageMoney(snapshot.spend.amount, snapshot.spend.currency)}
            </div>
            <div className={styles.sub}>
              {t('providerUsage.spendSince', { time: formatUsageTime(snapshot.spend.since) })}
            </div>
          </Flexbox>
        )}

        {snapshot?.windows?.map((window, index) => {
          const title = window.label
            ? `${t(usageWindowTitleKey(window.kind))} · ${window.label}`
            : t(usageWindowTitleKey(window.kind));
          const percent = window.remainingPercent;
          const reset = formatUsageTime(window.resetsAt);
          const unitText = window.unit ? ` ${t(`providerUsage.unit.${window.unit}`)}` : '';
          const counts =
            window.remaining !== undefined && window.limit !== undefined
              ? t('providerUsage.remainingOf', {
                  limit: `${formatUsageCount(window.limit)}${unitText}`,
                  remaining: formatUsageCount(window.remaining),
                })
              : undefined;

          return (
            <div className={styles.meter} key={`${window.kind}-${window.label ?? ''}-${index}`}>
              <div className={styles.meterHeading}>
                <span className={styles.meterLabel}>{title}</span>
                {percent !== undefined && (
                  <span className={styles.meterValue}>
                    {t('providerUsage.remainingPercent', { percent })}
                  </span>
                )}
              </div>
              {percent !== undefined && (
                <Progress
                  aria-label={`${title}: ${t('providerUsage.remainingPercent', { percent })}`}
                  percent={percent}
                  showInfo={false}
                  size="small"
                  status={resolveUsageStroke(percent)}
                />
              )}
              {counts && <div className={styles.sub}>{counts}</div>}
              {reset && (
                <div className={styles.sub}>{t('providerUsage.resets', { time: reset })}</div>
              )}
            </div>
          );
        })}

        {statusHint && <div className={styles.hint}>{statusHint}</div>}
        {snapshot?.status === 'ok' && !hasData && (
          <div className={styles.hint}>{t('providerUsage.status.unavailable')}</div>
        )}

        {isAdmin && snapshot && (
          <AdminKeyForm
            accountScope={input.accountScope}
            disabled={!canFetch}
            onSaved={(next) => utils.providerUsage.get.setData(input, next)}
            provider={provider}
            stored={snapshot.storedCredential}
          />
        )}

        {snapshot?.fetchedAt && snapshot.status !== 'noCredential' && (
          <div className={styles.sub}>
            {t('providerUsage.updatedAt', { time: formatUsageTime(snapshot.fetchedAt) })}
          </div>
        )}
      </Flexbox>
    );
  }),
);

ProviderUsageCard.displayName = 'ProviderUsageCard';

export default ProviderUsageCard;
