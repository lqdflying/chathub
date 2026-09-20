import { MessageMetadata } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BadgeCent, CoinsIcon } from 'lucide-react';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { resolveStoredMessageUsage } from '@/features/ChatInput/ActionBar/Token/getPromptCacheHitRate';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { formatNumber } from '@/utils/format';

import { getFooterTimeChipLabel } from './formatGenerationDuration';
import TokenDetail from './UsageDetail';
import { getDetailsToken } from './UsageDetail/tokens';

export const useStyles = createStyles(({ token, css }) => ({
  container: css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `,
  trigger: css`
    cursor: pointer;
  `,
}));

interface UsageProps {
  metadata: MessageMetadata;
  model: string;
  provider: string;
}

const Usage = memo<UsageProps>(({ model, metadata, provider }) => {
  const { styles } = useStyles();
  const usage = resolveStoredMessageUsage(metadata) ?? metadata;
  const timeLabel = getFooterTimeChipLabel(usage);
  const modelCard = useAiInfraStore(aiModelSelectors.getModelCard(model, provider));
  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit) && !!modelCard?.pricing;
  const detailTokens = getDetailsToken(usage, modelCard);
  const displayTotal = detailTokens.totalTokens
    ? isShowCredit
      ? formatNumber(detailTokens.totalTokens.credit)
      : formatNumber(detailTokens.totalTokens.token)
    : undefined;
  const hasChips = Boolean(timeLabel || displayTotal);

  const chips = (
    <Center gap={8} horizontal>
      {timeLabel ? <span>{timeLabel}</span> : null}
      {displayTotal ? (
        <Center gap={2} horizontal>
          <Icon icon={isShowCredit ? BadgeCent : CoinsIcon} />
          {displayTotal}
        </Center>
      ) : null}
    </Center>
  );

  return (
    <div className={styles.container}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
        <Center gap={4} horizontal style={{ fontSize: 12 }}>
          <ModelIcon model={model as string} type={'mono'} />
          {model}
        </Center>

        {hasChips ? (
          <TokenDetail meta={usage} model={model} provider={provider}>
            <span className={styles.trigger}>{chips}</span>
          </TokenDetail>
        ) : null}
      </Flexbox>
    </div>
  );
});

export default Usage;
