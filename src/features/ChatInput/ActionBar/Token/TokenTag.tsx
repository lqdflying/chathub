import { Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { Button } from 'antd';
import { useTheme } from 'antd-style';
import numeral from 'numeral';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { useEstimatedContextUsage } from '@/hooks/useEstimatedContextUsage';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';

interface TokenTagProps {
  total: string;
}
const Token = memo<TokenTagProps>(({ total: _messageString }) => {
  const { t } = useTranslation(['chat', 'components']);
  const theme = useTheme();
  const [compacting, setCompacting] = useState(false);

  const canManualCompact = useAgentStore(
    (s) =>
      agentChatConfigSelectors.enableHistoryCount(s) &&
      !!agentChatConfigSelectors.currentChatConfig(s).enableCompressHistory,
  );

  const {
    chatsToken,
    historySummaryToken,
    maxTokens,
    systemRoleToken,
    toolsToken,
    totalToken,
  } = useEstimatedContextUsage();

  const content = (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox align={'center'} gap={4} horizontal justify={'space-between'} width={'100%'}>
        <div style={{ color: theme.colorTextDescription }}>{t('tokenDetails.title')}</div>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: theme.colorFillTertiary,
              borderRadius: 4,
              color: theme.colorTextSecondary,
              fontFamily: theme.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      <TokenProgress
        data={[
          {
            color: theme.magenta,
            id: 'systemRole',
            title: t('tokenDetails.systemRole'),
            value: systemRoleToken,
          },
          {
            color: theme.geekblue,
            id: 'tools',
            title: t('tokenDetails.tools'),
            value: toolsToken,
          },
          {
            color: theme.orange,
            id: 'historySummary',
            title: t('tokenDetails.historySummary'),
            value: historySummaryToken,
          },
          {
            color: theme.gold,
            id: 'chats',
            title: t('tokenDetails.chats'),
            value: chatsToken,
          },
        ]}
        showIcon
      />
      <TokenProgress
        data={[
          {
            color: theme.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: theme.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
        showIcon
        showTotal={t('tokenDetails.total')}
      />
      <Button
        block
        disabled={!canManualCompact}
        loading={compacting}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setCompacting(true);
          try {
            await useChatStore.getState().triggerManualMemoryCompaction();
          } finally {
            setCompacting(false);
          }
        }}
        size={'small'}
        type={'default'}
      >
        {t('memoryCompaction.compactNow')}
      </Button>
    </Flexbox>
  );

  return (
    <ActionPopover content={content} title={t('tokenTag.popoverTitle')}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        style={{ marginLeft: 8 }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
        value={totalToken}
      />
    </ActionPopover>
  );
});

export default Token;
