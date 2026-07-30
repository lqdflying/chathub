'use client';

import type { MemoryCompactionDebugEntry } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { Collapse, Descriptions } from 'antd';
import { createStyles } from 'antd-style';
import { Bug, Eye } from 'lucide-react';
import numeral from 'numeral';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const useStyles = createStyles(({ css, token }) => ({
  mono: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  `,
}));

const MemoryCompactionDebug = memo(() => {
  const { styles, theme } = useStyles();
  const { t } = useTranslation('chat');
  const [showDebug, setShowDebug] = useState(false);

  const entries = useChatStore(
    (s) => topicSelectors.currentActiveTopic(s)?.metadata?.memoryDebugLog ?? [],
  );
  const historyContent = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );

  if (!entries.length) return null;

  const latest = entries.at(-1) as MemoryCompactionDebugEntry;
  const triggerLabel = t(`memoryCompaction.trigger.${latest.trigger}`, {
    defaultValue: latest.trigger,
  });

  const modelLabel =
    latest.provider && latest.model
      ? `${latest.provider} / ${latest.model}`
      : latest.model || latest.provider || '';

  return (
    <Flexbox gap={8} paddingInline={16} style={{ paddingBottom: 8 }}>
      <Collapse
        bordered={false}
        expandIconPosition={'end'}
        items={[
          {
            children: (
              <Flexbox gap={12}>
                <Flexbox gap={6} horizontal justify={'space-between'}>
                  <Text type={'secondary'}>{t('memoryCompaction.debug.title')}</Text>
                  <Center
                    onClick={() => setShowDebug(!showDebug)}
                    style={{ color: theme.colorTextDescription, cursor: 'pointer' }}
                  >
                    <Icon icon={showDebug ? Eye : Bug} size={16} />
                    <Text type={'secondary'}>
                      {t(showDebug ? 'memoryCompaction.debug.off' : 'memoryCompaction.debug.on')}
                    </Text>
                  </Center>
                </Flexbox>
                <Descriptions column={1} size={'small'}>
                  <Descriptions.Item label={t('memoryCompaction.debug.trigger')}>
                    {triggerLabel}
                  </Descriptions.Item>
                  {!!latest.status && (
                    <Descriptions.Item label={t('memoryCompaction.debug.status')}>
                      {t(`memoryCompaction.result.${latest.status}`, {
                        defaultValue: latest.status,
                      })}
                    </Descriptions.Item>
                  )}
                  {typeof latest.highWatermark === 'number' && (
                    <Descriptions.Item label={t('memoryCompaction.debug.watermarks')}>
                      {`${Math.round(latest.highWatermark * 100)}% -> ${Math.round(
                        (latest.lowWatermark ?? 0) * 100,
                      )}%`}
                    </Descriptions.Item>
                  )}
                  {typeof latest.estimatedTokensBefore === 'number' && (
                    <Descriptions.Item label={t('memoryCompaction.debug.approxTokensBefore')}>
                      {numeral(latest.estimatedTokensBefore).format('0,0')}
                    </Descriptions.Item>
                  )}
                  {typeof latest.estimatedTokensAfter === 'number' && (
                    <Descriptions.Item label={t('memoryCompaction.debug.approxTokensAfter')}>
                      {numeral(latest.estimatedTokensAfter).format('0,0')}
                    </Descriptions.Item>
                  )}
                  {typeof latest.messageCountIncluded === 'number' && (
                    <Descriptions.Item label={t('memoryCompaction.debug.messageCount')}>
                      {latest.messageCountIncluded}
                    </Descriptions.Item>
                  )}
                  {!!latest.compactedThroughMessageId && (
                    <Descriptions.Item label={t('memoryCompaction.debug.cursor')}>
                      {latest.compactedThroughMessageId}
                    </Descriptions.Item>
                  )}
                  {!!latest.reason && (
                    <Descriptions.Item label={t('memoryCompaction.debug.reason')}>
                      {latest.reason}
                    </Descriptions.Item>
                  )}
                  {!!modelLabel && (
                    <Descriptions.Item label={t('memoryCompaction.debug.model')}>
                      {modelLabel}
                    </Descriptions.Item>
                  )}
                </Descriptions>
                {showDebug && (
                  <Flexbox gap={4}>
                    <Text type={'secondary'}>{t('memoryCompaction.debug.rawResponse')}</Text>
                    <div className={styles.mono}>{historyContent}</div>
                  </Flexbox>
                )}
              </Flexbox>
            ),
            key: 'memory-debug',
            label: t('memoryCompaction.debug.title'),
          },
        ]}
        style={{ background: theme.colorFillQuaternary, borderRadius: 8 }}
      />
    </Flexbox>
  );
});

MemoryCompactionDebug.displayName = 'MemoryCompactionDebug';

export default MemoryCompactionDebug;
