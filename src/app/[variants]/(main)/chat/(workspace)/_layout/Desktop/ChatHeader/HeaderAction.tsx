'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

import SettingButton from '../../../features/SettingButton';

const HeaderAction = memo<{ className?: string }>(({ className }) => {
  const { t } = useTranslation('chat');
  const rightPanelHotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel));
  const [showAgentSettings, toggleConfig] = useGlobalStore((s) => [
    systemStatusSelectors.showChatSideBar(s),
    s.toggleChatSideBar,
  ]);
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);
  const { mutate: openNewTopic, isValidating: isOpeningNewTopic } = useActionSWR(
    'openNewTopicOrSaveTopic',
    openNewTopicOrSaveTopic,
  );

  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const newTopicTitle = t('topic.openNewTopic');

  return (
    <Flexbox align={'center'} className={className} gap={3} horizontal>
      <ActionIcon
        aria-label={newTopicTitle}
        icon={MessageSquarePlus}
        loading={isOpeningNewTopic}
        onClick={() => openNewTopic()}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={newTopicTitle}
        tooltipProps={{
          placement: 'bottom',
        }}
      />
      <ActionIcon
        icon={showAgentSettings ? PanelRightClose : PanelRightOpen}
        onClick={() => toggleConfig()}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={t('toggleRightPanel.title', { ns: 'hotkey' })}
        tooltipProps={{
          hotkey: rightPanelHotkey,
          placement: 'bottom',
        }}
      />
      {isAgentEditable && <SettingButton />}
    </Flexbox>
  );
});

export default HeaderAction;
