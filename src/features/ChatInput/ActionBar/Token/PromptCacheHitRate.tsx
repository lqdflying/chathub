import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import numeral from 'numeral';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InfoTooltip from '@/components/InfoTooltip';
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
  const source = useChatStore((s) => {
    const chats =
      conversationSource === 'portal'
        ? threadSelectors.portalAIChats(s)
        : chatSelectors.mainAIChats(s);

    return findLatestPromptCacheUsage(chats);
  }, isEqual);
  const result = getPromptCacheHitRate(source?.usage);

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
  const tooltipTitle = source?.fromModel
    ? `${t('tokenDetails.cacheCaption')} (${t('tokenDetails.cacheSource', { model: source.fromModel })})`
    : t('tokenDetails.cacheCaption');
  const summaryParts = result
    ? [
        result.cacheHitRate !== undefined
          ? t('tokenDetails.cacheHitRate', {
              percent: (result.cacheHitRate * 100).toFixed(1),
            })
          : statusLabel,
        result.cacheHitRate !== undefined ? statusLabel : undefined,
        result.cacheHitTokens !== undefined && result.cacheEligibleTokens !== undefined
          ? t('tokenDetails.cacheRatio', {
              cached: formatTokens(result.cacheHitTokens),
              input: formatTokens(result.cacheEligibleTokens),
            })
          : undefined,
      ].filter(Boolean)
    : [];

  return (
    <Flexbox gap={4} width={'100%'}>
      <Flexbox align={'center'} gap={4} horizontal>
        <div style={{ color: theme.colorTextDescription }}>{t('tokenDetails.cacheTitle')}</div>
        <InfoTooltip size={'small'} title={tooltipTitle} />
      </Flexbox>
      {!result ? (
        <div style={{ color: theme.colorTextSecondary, fontSize: 12, lineHeight: 1.35 }}>
          {t('tokenDetails.cacheEmpty')}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}>
            {summaryParts.join(' · ')}
          </div>
          {showBar && (
            <TokenProgress
              compact
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
              hideLegend
            />
          )}
        </>
      )}
    </Flexbox>
  );
});

PromptCacheHitRate.displayName = 'PromptCacheHitRate';

export default PromptCacheHitRate;
