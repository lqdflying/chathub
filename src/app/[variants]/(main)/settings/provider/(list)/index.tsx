'use client';

import { parseAsString, useQueryState } from 'nuqs';

import { isCustomBranding } from '@/const/version';

import DesktopLayout from '../_layout/Desktop';
import MobileLayout from '../_layout/Mobile';
import ProviderDetailPage from '../detail';
import { pushProviderDetailEntry, retainProviderDetailEntry } from '../providerDetailHistory';
import Footer from './Footer';

const Page = (props: { mobile?: boolean }) => {
  const [Provider, setProvider] = useQueryState('provider', parseAsString.withDefault('all'));
  const { mobile } = props;
  const ProviderLayout = mobile ? MobileLayout : DesktopLayout;
  const onProviderSelect = (providerKey: string) => {
    if (!mobile) {
      void setProvider(providerKey, { history: 'replace' });
      return;
    }

    const preservedState = pushProviderDetailEntry(providerKey);
    if (!preservedState) {
      void setProvider(providerKey, { history: 'replace' });
      return;
    }

    // An outside pushState aborts nuqs' queued write. Queue the query update
    // after that abort, and replace so nuqs does not add a second detail entry.
    queueMicrotask(() => {
      void setProvider(providerKey, { history: 'replace' }).then(() => {
        retainProviderDetailEntry(providerKey, preservedState);
      });
    });
  };
  return (
    <ProviderLayout onProviderSelect={onProviderSelect}>
      <ProviderDetailPage id={Provider} />
      {!isCustomBranding && <Footer />}
    </ProviderLayout>
  );
};

Page.displayName = 'ProviderGrid';

export default Page;
