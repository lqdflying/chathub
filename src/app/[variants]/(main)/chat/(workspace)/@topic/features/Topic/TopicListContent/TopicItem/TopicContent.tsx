import { ActionIcon, Dropdown, EditableText, Icon, type MenuProps, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import {
  LucideCopy,
  LucideLoader2,
  MoreVertical,
  PencilLine,
  ScrollText,
  Star,
  Trash,
  Wand2,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import TopicSummaryViewer from '@/features/TopicSummaryViewer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { reportTopicBusyChanged } from '@/libs/logger/generationDebugClient';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { formatTopicActivityTime } from '@/utils/client/topic';

const useStyles = createStyles(({ css }) => ({
  content: css`
    position: relative;
    overflow: hidden;
    flex: 1;
  `,
  title: css`
    flex: 1;
    height: 28px;
    line-height: 28px;
    text-align: start;
  `,
}));

interface TopicContentProps {
  fav?: boolean;
  id: string;
  lastActivityAt?: number;
  showMore?: boolean;
  title: string;
}

const TopicContent = memo<TopicContentProps>(({ id, title, fav, lastActivityAt, showMore }) => {
  const { t } = useTranslation(['topic', 'common', 'chat']);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const hasSummary = useChatStore(
    (s) => !!(topicSelectors.getTopicById(id)(s)?.historySummary || '').trim(),
  );

  const mobile = useIsMobile();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const [
    editing,
    favoriteTopic,
    updateTopicTitle,
    removeTopic,
    autoRenameTopicTitle,
    duplicateTopic,
    isLoading,
  ] = useChatStore((s) => [
    s.topicRenamingId === id,
    s.favoriteTopic,
    s.updateTopicTitle,
    s.removeTopic,
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    topicSelectors.isTopicLoading(id)(s),
  ]);
  const { styles, theme } = useStyles();

  useEffect(() => {
    try {
      const state = useChatStore.getState?.();
      const flags = state
        ? topicSelectors.topicBusyFlags(id)(state)
        : {
            deferredLane: false,
            durableJob: false,
            producing: isLoading,
            sendRpc: false,
            tools: false,
            topicCrud: false,
          };
      reportTopicBusyChanged(id, isLoading, flags);
    } catch {
      // Diagnostics must never break the topic list.
    }
  }, [id, isLoading]);

  const activityTime = lastActivityAt ? new Date(lastActivityAt) : undefined;
  const activityLabel = activityTime
    ? formatTopicActivityTime(activityTime.getTime(), locale)
    : undefined;

  const toggleEditing = (visible?: boolean) => {
    useChatStore.setState({ topicRenamingId: visible ? id : '' });
  };

  const { modal } = App.useApp();

  const items = useMemo<MenuProps['items']>(
    () => [
      {
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: () => {
          autoRenameTopicTitle(id);
        },
      },
      {
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          toggleEditing(true);
        },
      },
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: () => {
          duplicateTopic(id);
        },
      },
      // {
      //   icon: <Icon icon={LucideDownload} />,
      //   key: 'export',
      //   label: t('topic.actions.export'),
      //   onClick: () => {
      //     configService.exportSingleTopic(sessionId, id);
      //   },
      // },
      ...(hasSummary
        ? [
            {
              icon: <Icon icon={ScrollText} />,
              key: 'viewCompactionSummary',
              label: t('memoryCompaction.viewer.open', { ns: 'chat' }),
              onClick: () => {
                setSummaryOpen(true);
              },
            },
          ]
        : []),
      {
        type: 'divider',
      },
      // {
      //   icon: <Icon icon={Share2} />,
      //   key: 'share',
      //   label: t('share'),
      // },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          if (!id) return;

          modal.confirm({
            centered: true,
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeTopic(id);
            },
            title: t('actions.confirmRemoveTopic'),
          });
        },
      },
    ],
    [
      id,
      autoRenameTopicTitle,
      duplicateTopic,
      hasSummary,
      removeTopic,
      t,
      toggleEditing,
    ],
  );

  return (
    <Flexbox
      align={'center'}
      gap={8}
      horizontal
      justify={'space-between'}
      onDoubleClick={(e) => {
        if (!id) return;
        if (e.altKey) toggleEditing(true);
      }}
    >
      <ActionIcon
        aria-busy={isLoading}
        aria-label={isLoading ? t('generating') : t('favorite')}
        color={fav && !isLoading ? theme.colorWarning : undefined}
        fill={fav && !isLoading ? theme.colorWarning : 'transparent'}
        icon={isLoading ? LucideLoader2 : Star}
        onClick={(e) => {
          e.stopPropagation();
          if (!id || isLoading) return;
          favoriteTopic(id, !fav);
        }}
        size={'small'}
        spin={isLoading}
        title={isLoading ? t('generating') : undefined}
      />
      {!editing ? (
        title === LOADING_FLAT ? (
          <Flexbox flex={1} height={28} justify={'center'}>
            <BubblesLoading />
          </Flexbox>
        ) : (
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <Text
              className={styles.title}
              ellipsis={{ rows: 1, tooltip: { placement: 'left', title } }}
              style={{ margin: 0 }}
            >
              {title}
            </Text>
            {activityTime && activityLabel && (
              <time
                dateTime={activityTime.toISOString()}
                style={{
                  color: theme.colorTextDescription,
                  fontSize: 11,
                  lineHeight: '14px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={activityTime.toLocaleString(locale)}
              >
                {activityLabel}
              </time>
            )}
          </Flexbox>
        )
      ) : (
        <EditableText
          editing={editing}
          onChangeEnd={(v) => {
            if (title !== v) {
              updateTopicTitle(id, v);
            }
            toggleEditing(false);
          }}
          onEditingChange={toggleEditing}
          showEditIcon={false}
          style={{ height: 28 }}
          value={title}
        />
      )}
      {(showMore || mobile) && !editing && (
        <Dropdown
          arrow={false}
          menu={{
            items: items,
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
            },
          }}
          trigger={['click']}
        >
          <ActionIcon
            className="topic-more"
            icon={MoreVertical}
            onClick={(e) => {
              e.stopPropagation();
            }}
            size={'small'}
          />
        </Dropdown>
      )}
      {summaryOpen && (
        <TopicSummaryViewer onClose={() => setSummaryOpen(false)} open topicId={id} />
      )}
    </Flexbox>
  );
});

export default TopicContent;
