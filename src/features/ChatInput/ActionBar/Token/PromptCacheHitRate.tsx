import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import numeral from 'numeral';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { EstimatedContextConversationSource } from '@/hooks/useEstimatedContextUsage';
import { useChatStore } from '@/store/chat';
import { chatSelectors, threadSelectors } from '@/store/chat/selectors';

import TokenProgress from './TokenProgress';
import { findLatestPromptCacheUsage, getPromptCacheHitRate } from './getPromptCacheHitRate';

interface PromptCacheHitRateProps {
  conversationSource?: EstimatedContextConversationSource;
}

const formatTokens = (value: number) => numeral(value).format('0,0');

const PromptCacheHitRate = memo<PromptCacheHitRateProps>(({ conversationSource = 'main' }) => {
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const usage = useChatStore((s) => {
    const chats =
      conversationSource === 'portal'
        ? threadSelectors.portalAIChats(s)
        : chatSelectors.mainAIChats(s);

    return findLatestPromptCacheUsage(chats);
  }, isEqual);
  const result = getPromptCacheHitRate(usage);

  const statusLabel =
    result?.status === 'hit'
      ? t('tokenDetails.cacheStatusWorking')
      : result?.status === 'miss'
        ? t('tokenDetails.cacheStatusNoHit')
        : result
          ? t('tokenDetails.cacheStatusReported')
          : undefined;

  const remainder =
    result?.cacheHitTokens !== undefined && result.cacheEligibleTokens !== undefined
      ? Math.max(0, result.cacheEligibleTokens - result.cacheHitTokens)
      : 0;
  const showBar = (result?.cacheHitTokens ?? 0) + remainder > 0;

  return (
    <Flexbox gap={8} width={'100%'}>
      <div style={{ color: theme.colorTextDescription }}>{t('tokenDetails.cacheTitle')}</div>
      {!result ? (
        <div style={{ color: theme.colorTextSecondary }}>{t('tokenDetails.cacheEmpty')}</div>
      ) : (
        <>
          <Flexbox align={'baseline'} gap={8} horizontal justify={'space-between'}>
            <div style={{ fontWeight: 500 }}>
              {result.cacheHitRate !== undefined
                ? t('tokenDetails.cacheHitRate', {
                    percent: (result.cacheHitRate * 100).toFixed(1),
                  })
                : statusLabel}
            </div>
            {result.cacheHitRate !== undefined && (
              <div style={{ color: theme.colorTextSecondary }}>{statusLabel}</div>
            )}
          </Flexbox>
          {result.cacheHitTokens !== undefined && result.cacheEligibleTokens !== undefined && (
            <div style={{ color: theme.colorTextSecondary }}>
              {t('tokenDetails.cacheRatio', {
                cached: formatTokens(result.cacheHitTokens),
                eligible: formatTokens(result.cacheEligibleTokens),
              })}
            </div>
          )}
          {showBar && (
            <TokenProgress
              data={[
                {
                  color: theme.orange,
                  id: 'cached',
                  title: t('tokenDetails.cacheCached'),
                  value: result.cacheHitTokens ?? 0,
                },
                {
                  color: theme.colorFill,
                  id: 'uncached',
                  title: t('tokenDetails.cacheUncached'),
                  value: remainder,
                },
              ]}
              showIcon
            />
          )}
        </>
      )}
      <div style={{ color: theme.colorTextTertiary, fontSize: 12 }}>
        {t('tokenDetails.cacheCaption')}
      </div>
    </Flexbox>
  );
});

PromptCacheHitRate.displayName = 'PromptCacheHitRate';

export default PromptCacheHitRate;
