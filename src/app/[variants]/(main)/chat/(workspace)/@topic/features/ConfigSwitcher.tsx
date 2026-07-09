'use client';

import { memo } from 'react';

import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import GroupConfig from './GroupConfig';

const ConfigSwitcher = memo(() => {
  const isInbox = useSessionStore(sessionSelectors.isInboxSession);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  if (isInbox) return;
  if (isGroupSession) return <GroupConfig />;
  return;
});

ConfigSwitcher.displayName = 'ConfigSwitcher';

export default ConfigSwitcher;
