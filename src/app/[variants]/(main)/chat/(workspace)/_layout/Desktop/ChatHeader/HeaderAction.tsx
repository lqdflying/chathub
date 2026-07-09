'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useActionSWR } from '@/libs/swr';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

import SettingButton from '../../../features/SettingButton';

const HeaderAction = memo<{ className?: string }>(({ className }) => {
  const { t } = useTranslation('chat');
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel));
  const [showAgentSettings, toggleConfig] = useGlobalStore((s) => [
    systemStatusSelectors.showChatSideBar(s),
    s.toggleChatSideBar,
  ]);
  const createSession = useSessionStore((s) => s.createSession);
  const { mutate: mutateAgent, isValidating: isValidatingAgent } = useActionSWR(
    'session.createSession',
    () => createSession(),
  );

  const { isAgentEditable, showCreateSession } = useServerConfigStore(featureFlagsSelectors);

  return (
    <Flexbox align={'center'} className={className} gap={3} horizontal>
      {showCreateSession && (
        <ActionIcon
          icon={MessageSquarePlus}
          loading={isValidatingAgent}
          onClick={() => mutateAgent()}
          size={DESKTOP_HEADER_ICON_SIZE}
          title={t('newAgent')}
          tooltipProps={{
            placement: 'bottom',
          }}
        />
      )}
      <ActionIcon
        icon={showAgentSettings ? PanelRightClose : PanelRightOpen}
        onClick={() => toggleConfig()}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={t('toggleRightPanel.title', { ns: 'hotkey' })}
        tooltipProps={{
          hotkey,
          placement: 'bottom',
        }}
      />
      {isAgentEditable && <SettingButton />}
    </Flexbox>
  );
});

export default HeaderAction;
