'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/chat';
import { Drawer, type DrawerProps } from 'antd';
import { createStyles } from 'antd-style';
import { Menu } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BrandWatermark from '@/components/BrandWatermark';
import { useActiveSettingsKey } from '@/hooks/useActiveTabKey';
import { useProviderName } from '@/hooks/useProviderName';
import { SettingsTabs } from '@/store/global/initialState';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    position: relative;

    flex: none;

    height: 56px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgLayout};
  `,
  title: css`
    font-size: 17px;
    font-weight: 600;
    line-height: 1.2;
    color: ${token.colorText};
  `,
}));

interface HeaderProps extends Pick<DrawerProps, 'getContainer'> {
  children: ReactNode;
  title?: ReactNode;
}

const Header = memo<HeaderProps>(({ children, getContainer, title }) => {
  const [open, setOpen] = useState(false);
  const { styles, theme } = useStyles();
  const activeKey = useActiveSettingsKey();
  const providerName = useProviderName(activeKey);

  const search = useSearchParams();
  const active = search.get('active');
  const { t } = useTranslation('setting');

  const isProvider = active === SettingsTabs.Provider;
  const dynamicTitle = title ? title : isProvider ? providerName : t(`tab.${activeKey}`);

  return (
    <>
      <ChatHeader
        className={styles.container}
        left={
          <ChatHeader.Title
            title={
              <Flexbox align={'center'} className={styles.title} gap={4} horizontal>
                <ActionIcon
                  color={theme.colorText}
                  icon={Menu}
                  onClick={() => setOpen(true)}
                  size={{ blockSize: 32, size: 18 }}
                />
                {dynamicTitle}
              </Flexbox>
            }
          />
        }
        styles={{
          left: {
            padding: 0,
          },
        }}
      />
      <Drawer
        getContainer={getContainer}
        onClick={() => setOpen(false)}
        onClose={() => setOpen(false)}
        open={open}
        placement={'left'}
        rootStyle={{ position: 'absolute' }}
        style={{
          background: theme.colorBgLayout,
          borderRight: `1px solid ${theme.colorBorderSecondary}`,
        }}
        styles={{
          body: {
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            justifyContent: 'space-between',
            paddingBlock: 16,
            paddingInline: 12,
          },
          header: { display: 'none' },
          mask: { background: 'transparent' },
        }}
        width={260}
        zIndex={10}
      >
        {children}
        <BrandWatermark paddingInline={12} />
      </Drawer>
    </>
  );
});

export default Header;
