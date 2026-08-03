'use client';

import { parseAsStringEnum, useQueryState } from 'nuqs';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';
import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from '../SettingsContent';
import Header from './Header';

const Layout = () => {
  const [activeTab] = useQueryState(
    'active',
    parseAsStringEnum(Object.values(SettingsTabs)).withDefault(SettingsTabs.Common),
  );

  return (
    <MobileContentLayout header={<Header activeSettingsKey={activeTab} />}>
      <SettingsContent activeTab={activeTab} mobile={true} />
      <Footer />
    </MobileContentLayout>
  );
};

Layout.displayName = 'MobileSettingsLayout';

export default Layout;
