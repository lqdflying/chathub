'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { useTheme } from 'antd-style';
import { ListTree } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { INBOX_SESSION_ID } from '@/const/session';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import SettingButton from '../../../features/SettingButton';
import ShareButton from '../../../features/ShareButton';
import ChatHeaderTitle from './ChatHeaderTitle';

const MobileHeader = memo(() => {
  const { t: tHotkey } = useTranslation('hotkey');
  const router = useQueryRoute();
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const [mobileShowTopic, toggleMobileTopic] = useGlobalStore((s) => [
    systemStatusSelectors.mobileShowTopic(s),
    s.toggleMobileTopic,
  ]);

  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);

  return (
    <ChatHeader
      center={<ChatHeaderTitle />}
      onBackClick={() =>
        router.push('/chat', { query: { session: INBOX_SESSION_ID }, replace: true })
      }
      right={
        <>
          <ActionIcon
            aria-controls="mobile-topic-modal"
            aria-expanded={mobileShowTopic}
            aria-label={tHotkey('toggleRightPanel.title')}
            icon={ListTree}
            onClick={() => toggleMobileTopic(true)}
            size={MOBILE_HEADER_ICON_SIZE}
            title={tHotkey('toggleRightPanel.title')}
            tooltipProps={{
              placement: 'bottom',
            }}
          />
          <ShareButton mobile open={open} setOpen={setOpen} />
          {isAgentEditable && <SettingButton mobile />}
        </>
      }
      showBackButton
      style={{
        borderBlockEnd: `1px solid ${theme.colorBorderSecondary}`,
        width: '100%',
      }}
    />
  );
});

export default MobileHeader;
