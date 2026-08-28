'use client';

import { ChatHeader, ChatHeaderTitle } from '@lobehub/ui/chat';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { pathString } from '@/utils/url';

const Header = memo(() => {
  const { t } = useTranslation('setting');
  const router = useRouter();

  return (
    <ChatHeader
      left={<ChatHeaderTitle title={t('header.session')} />}
      onBackClick={() => router.push(pathString('/chat', { search: location.search }))}
      showBackButton
    />
  );
});

export default Header;
