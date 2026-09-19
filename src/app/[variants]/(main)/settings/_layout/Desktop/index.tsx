'use client';

import { useResponsive, useTheme } from 'antd-style';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { memo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import SettingContainer from '@/features/Setting/SettingContainer';
import { SettingsTabs } from '@/store/global/initialState';

import CategoryContent from '../CategoryContent';
import SettingsContent from '../SettingsContent';
import { LayoutProps } from '../type';
import { DESKTOP_SETTINGS_LAYOUT_STYLE } from './desktopSettingsLayoutStyle';
import Header from './Header';
import SideBar from './SideBar';

const Layout = memo<LayoutProps>((props) => {
  const { showLLM = true } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const { md = true } = useResponsive();
  const theme = useTheme();

  const [activeTab, setActiveTab] = useQueryState(
    'active',
    parseAsStringEnum(Object.values(SettingsTabs)).withDefault(SettingsTabs.Common),
  );

  const category = <CategoryContent activeTab={activeTab} onMenuSelect={setActiveTab} />;

  return (
    <Flexbox
      data-testid="desktop-settings-layout"
      height={'100%'}
      horizontal={md}
      ref={ref}
      style={{ background: theme.colorBgContainer, ...DESKTOP_SETTINGS_LAYOUT_STYLE }}
    >
      {md ? (
        <SideBar>{category}</SideBar>
      ) : (
        <Header activeKey={activeTab} getContainer={() => ref.current!}>
          {category}
        </Header>
      )}
      <SettingContainer flex={1} maxWidth={'none'} style={{ minWidth: 0 }}>
        <SettingsContent activeTab={activeTab} mobile={false} showLLM={showLLM} />
      </SettingContainer>
    </Flexbox>
  );
});

Layout.displayName = 'DesktopSettingsLayout';

export default Layout;
