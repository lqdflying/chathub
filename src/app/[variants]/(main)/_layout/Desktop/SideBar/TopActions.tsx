import { ActionIcon, ActionIconProps, Hotkey } from '@lobehub/ui';
import { FolderClosed, Image as ImageIcon, Images, MessageSquare, Wrench } from 'lucide-react';
import Link from 'next/link';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { TOUCH_TARGET_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

const ICON_SIZE: ActionIconProps['size'] = {
  blockSize: TOUCH_TARGET_SIZE,
  size: 20,
  strokeWidth: 2,
};

export interface TopActionProps {
  isPinned?: boolean | null;
  tab?: SidebarTabKey;
}

//  TODO Change icons
const TopActions = memo<TopActionProps>(({ tab, isPinned }) => {
  const { t } = useTranslation('common');
  const switchBackToChat = useGlobalStore((s) => s.switchBackToChat);
  const { enableKnowledgeBase, showAiImage } = useServerConfigStore(featureFlagsSelectors);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.NavigateToChat));

  // Check if server mode is enabled

  const isChatActive = tab === SidebarTabKey.Chat && !isPinned;
  const isFilesActive = tab === SidebarTabKey.Files;
  const isImageActive = tab === SidebarTabKey.Image;
  const isToolsActive = tab === SidebarTabKey.Tools;
  const isArtifactsActive = tab === SidebarTabKey.Artifacts;

  return (
    <Flexbox gap={6}>
      <Link
        aria-label={t('tab.chat')}
        href={'/chat'}
        onClick={(e) => {
          // If Cmd key is pressed, let the default link behavior happen (open in new tab)
          if (e.metaKey || e.ctrlKey) {
            return;
          }

          // Otherwise, prevent default and switch session within the current tab
          e.preventDefault();
          switchBackToChat(useSessionStore.getState().activeId);
        }}
      >
        <ActionIcon
          active={isChatActive}
          icon={MessageSquare}
          size={ICON_SIZE}
          title={
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <span>{t('tab.chat')}</span>
              <Hotkey inverseTheme keys={hotkey} />
            </Flexbox>
          }
          tooltipProps={{ placement: 'right' }}
        />
      </Link>
      {enableKnowledgeBase && (
        <Link aria-label={t('tab.knowledgeBase')} href={'/knowledge'}>
          <ActionIcon
            active={isFilesActive}
            icon={FolderClosed}
            size={ICON_SIZE}
            title={t('tab.knowledgeBase')}
            tooltipProps={{ placement: 'right' }}
          />
        </Link>
      )}
      {showAiImage && (
        <Link aria-label={t('tab.aiImage')} href={'/image'}>
          <ActionIcon
            active={isImageActive}
            icon={ImageIcon}
            size={ICON_SIZE}
            title={t('tab.aiImage')}
            tooltipProps={{ placement: 'right' }}
          />
        </Link>
      )}
      <Link aria-label={t('tab.tools')} href={'/tools'}>
        <ActionIcon
          active={isToolsActive}
          icon={Wrench}
          size={ICON_SIZE}
          title={t('tab.tools')}
          tooltipProps={{ placement: 'right' }}
        />
      </Link>
      <Link aria-label={t('tab.artifacts')} href={'/artifacts'}>
        <ActionIcon
          active={isArtifactsActive}
          icon={Images}
          size={ICON_SIZE}
          title={t('tab.artifacts')}
          tooltipProps={{ placement: 'right' }}
        />
      </Link>
    </Flexbox>
  );
});

export default TopActions;
