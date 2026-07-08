'use client';

import { createStyles, useResponsive } from 'antd-style';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { memo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import InitClientDB from '@/features/InitClientDB';
import SettingContainer from '@/features/Setting/SettingContainer';
import { SettingsTabs } from '@/store/global/initialState';

import CategoryContent from '../CategoryContent';
import SettingsContent from '../SettingsContent';
import { LayoutProps } from '../type';
import Header from './Header';
import SideBar from './SideBar';

const useStyles = createStyles(({ css, token }) => ({
  content: css`
    min-width: 0;
    background: ${token.colorBgContainer};
  `,
  shell: css`
    position: relative;
    flex: 1;
    min-width: 0;
    background: ${token.colorBgLayout};
  `,
}));

const Layout = memo<LayoutProps>((props) => {
  const { showLLM = true } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const { md = true } = useResponsive();
  const { styles } = useStyles();

  const [activeTab, setActiveTab] = useQueryState(
    'active',
    parseAsStringEnum(Object.values(SettingsTabs)).withDefault(SettingsTabs.Common),
  );

  const category = <CategoryContent activeTab={activeTab} onMenuSelect={setActiveTab} />;

  return (
    <Flexbox
      className={styles.shell}
      height={'100%'}
      horizontal={md}
      ref={ref}
    >
      {md ? (
        <SideBar>{category}</SideBar>
      ) : (
        <Header getContainer={() => ref.current!}>{category}</Header>
      )}
      <SettingContainer className={styles.content} maxWidth={'none'}>
        <SettingsContent activeTab={activeTab} mobile={false} showLLM={showLLM} />
      </SettingContainer>
      <InitClientDB />
    </Flexbox>
  );
});

Layout.displayName = 'DesktopSettingsLayout';

export default Layout;
