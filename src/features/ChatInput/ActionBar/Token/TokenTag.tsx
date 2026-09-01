import { Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { Button } from 'antd';
import { useTheme } from 'antd-style';
import numeral from 'numeral';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import TopicSummaryViewer from '@/features/TopicSummaryViewer';
import {
  EstimatedContextConversationSource,
  useEstimatedContextUsage,
} from '@/hooks/useEstimatedContextUsage';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { aiChatSelectors, topicSelectors } from '@/store/chat/selectors';

import ActionPopover from '../components/ActionPopover';
import { MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX } from '../components/mobileOverlayWidth';
import ContextExportControl from './ContextExportControl';
import { formatHistoryWindowLimitLine } from './formatHistoryWindowLimitLine';
import PromptCacheHitRate from './PromptCacheHitRate';
import TokenProgress from './TokenProgress';

interface TokenTagProps {
  conversationSource?: EstimatedContextConversationSource;
}
const Token = memo<TokenTagProps>(({ conversationSource }) => {
  const { t } = useTranslation(['chat', 'components']);
  const theme = useTheme();
  const isMobile = useIsMobile();
  const [awaitingTrigger, setAwaitingTrigger] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const durableCompacting = useChatStore(aiChatSelectors.isActiveTopicMemoryCompacting);
  const compacting = awaitingTrigger || durableCompacting;
  const hasTopicSummary = useChatStore(
    (s) => !!topicSelectors.currentActiveTopicSummary(s)?.content,
  );

  const canManualCompact = useAgentStore(
    (s) =>
      agentChatConfigSelectors.enableHistoryCount(s) &&
      !!agentChatConfigSelectors.currentChatConfig(s).enableCompressHistory,
  );
  const isRegularTopic = useChatStore(
    (s) =>
      !!s.activeTopicId &&
      s.activeSessionType !== 'group' &&
      !s.activeThreadId &&
      !s.portalThreadId,
  );

  useEffect(() => {
    setAwaitingTrigger(false);
  }, [activeTopicId]);

  const {
    chatInstructionToken,
    chatsToken,
    historySummaryToken,
    historyWindow,
    knowledgeBaseToken,
    lastCompactionStatus,
    maxTokens,
    memoryToken,
    roleSettingsToken,
    topicChatsToken,
    toolsToken,
    totalToken,
  } = useEstimatedContextUsage(conversationSource);
  const contextExportAllocation = useMemo(
    () => ({
      assistantMemory: memoryToken,
      chatInstruction: chatInstructionToken,
      chatMessages: chatsToken,
      historySummary: historySummaryToken,
      knowledgeBase: knowledgeBaseToken,
      pluginSettings: toolsToken,
      roleSettings: roleSettingsToken,
      total: totalToken,
    }),
    [
      chatInstructionToken,
      chatsToken,
      historySummaryToken,
      knowledgeBaseToken,
      memoryToken,
      roleSettingsToken,
      toolsToken,
      totalToken,
    ],
  );

  const content = (
    <Flexbox gap={8} style={{ minWidth: 200 }}>
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
        compact
        data={[
          {
            color: theme.magenta,
            id: 'chatInstruction',
            title: t('tokenDetails.chatInstruction'),
            value: chatInstructionToken,
          },
          {
            color: theme.cyan,
            id: 'roleSettings',
            title: t('tokenDetails.roleSettings'),
            value: roleSettingsToken,
          },
          {
            color: theme.purple,
            id: 'assistantMemory',
            title: t('tokenDetails.assistantMemory'),
            value: memoryToken,
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
            color: theme.volcano,
            id: 'knowledgeBase',
            title: t('tokenDetails.knowledgeBase'),
            value: knowledgeBaseToken,
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
        compact
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
      {historyWindow.enableHistoryCount && (
        <Flexbox gap={4}>
          <div style={{ color: theme.colorTextDescription, fontSize: 12 }}>
            {t('tokenDetails.historyWindow.title')}
          </div>
          <div style={{ color: theme.colorTextSecondary, fontSize: 12 }}>
            {t('tokenDetails.historyWindow.includedOfTopic', {
              included: historyWindow.includedMessageCount,
              topic: historyWindow.topicMessageCount,
            })}
          </div>
          <div style={{ color: theme.colorTextSecondary, fontSize: 12 }}>
            {formatHistoryWindowLimitLine(historyWindow, t)}
            {historyWindow.excludedByCursor > 0
              ? ` · ${t('tokenDetails.historyWindow.excludedByCursor')}: ${historyWindow.excludedByCursor}`
              : ''}
            {historyWindow.excludedByHistoryCount > 0
              ? ` · ${t('tokenDetails.historyWindow.excludedByHistoryCount')}: ${historyWindow.excludedByHistoryCount}`
              : ''}
          </div>
          <div style={{ color: theme.colorTextSecondary, fontSize: 12 }}>
            {t('tokenDetails.historyWindow.topicChats')}: {numeral(topicChatsToken).format('0,0')}
          </div>
          {lastCompactionStatus && (
            <div style={{ color: theme.colorTextSecondary, fontSize: 12 }}>
              {t('tokenDetails.historyWindow.compactionStatus')}:{' '}
              {t(`memoryCompaction.result.${lastCompactionStatus}`, {
                defaultValue: lastCompactionStatus,
              })}
            </div>
          )}
          {historyWindow.warnUncoveredExclusion && (
            <div style={{ color: theme.colorWarning, fontSize: 12 }}>
              {t('tokenDetails.historyWindow.warnUncovered')}
            </div>
          )}
        </Flexbox>
      )}
      <PromptCacheHitRate conversationSource={conversationSource} />
      {conversationSource !== 'portal' && (
        <Button
          block
          disabled={!canManualCompact || !isRegularTopic || compacting}
          loading={compacting}
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (compacting) return;
            setAwaitingTrigger(true);
            try {
              const result = await useChatStore.getState().triggerManualMemoryCompaction();
              const { notification } = await import('@/components/AntdStaticMethods');
              const message = t(`memoryCompaction.result.${result.status}`);
              switch (result.status) {
                case 'compacted': {
                  notification.success({ message });
                  break;
                }
                case 'enqueued': {
                  notification.info({ message });
                  break;
                }
                case 'failed': {
                  notification.error({ message });
                  break;
                }
                case 'target_unreachable': {
                  notification.warning({ message });
                  break;
                }
                default: {
                  notification.info({ message });
                }
              }
            } finally {
              setAwaitingTrigger(false);
            }
          }}
          size={'small'}
          type={'default'}
        >
          {compacting ? t('memoryCompaction.compacting') : t('memoryCompaction.compactNow')}
        </Button>
      )}
      {conversationSource !== 'portal' && isRegularTopic && (
        <Button
          block
          disabled={!hasTopicSummary}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSummaryOpen(true);
          }}
          size={'small'}
        >
          {t('memoryCompaction.viewer.open')}
        </Button>
      )}
      <ContextExportControl allocation={contextExportAllocation} />
    </Flexbox>
  );

  return (
    <ActionPopover
      compact
      content={content}
      maxWidth={isMobile ? MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX : undefined}
      title={t('tokenTag.popoverTitle')}
    >
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
      {summaryOpen && activeTopicId && (
        <TopicSummaryViewer onClose={() => setSummaryOpen(false)} open topicId={activeTopicId} />
      )}
    </ActionPopover>
  );
});

export default Token;
