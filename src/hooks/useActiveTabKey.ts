import { usePathname } from 'next/navigation';

import { ProfileTabs, SidebarTabKey } from '@/store/global/initialState';

/**
 * Returns the active tab key (chat/market/settings/...)
 */
export const useActiveTabKey = () => {
  const pathname = usePathname();

  return pathname.split('/').find(Boolean)! as SidebarTabKey;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 */
export const useActiveProfileKey = () => {
  const pathname = usePathname();

  const tabs = pathname.split('/').at(-1);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
