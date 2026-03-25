'use client';

import { Icon } from '@lobehub/ui';
import { Images, KeyRound, Zap } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';

const Nav = memo(() => {
  const { t } = useTranslation('tools');
  const pathname = usePathname();
  const router = useRouter();

  const activeKey = pathname.split('/').at(-1) || 'picbed';

  const items = [
    {
      icon: <Icon icon={Images} />,
      key: 'picbed',
      label: t('picbed.title'),
    },
    {
      icon: <Icon icon={KeyRound} />,
      key: 'password',
      label: t('password.title'),
    },
    {
      icon: <Icon icon={Zap} />,
      key: 'apitest',
      label: t('apitest.title'),
    },
  ];

  return (
    <Menu
      compact
      items={items}
      onClick={({ key }) => router.push(`/tools/${key}`)}
      selectable
      selectedKeys={[activeKey]}
    />
  );
});

Nav.displayName = 'ToolsNav';

export default Nav;
