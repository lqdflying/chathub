'use client';

import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import React, { PropsWithChildren, useCallback, useState } from 'react';

import { API_ENDPOINTS } from '@/services/_url';

import SessionFreshnessPoller from './SessionFreshnessPoller';
import UserUpdater from './UserUpdater';

interface NextAuthProps extends PropsWithChildren {
  initialSession: Session | null;
}

const NextAuth = ({ children, initialSession }: NextAuthProps) => {
  const [sessionSnapshot, setSessionSnapshot] = useState(initialSession);
  const [sessionSnapshotGeneration, setSessionSnapshotGeneration] = useState(0);

  const reconcileSession = useCallback((nextSession: Session | null) => {
    setSessionSnapshot(nextSession);
    setSessionSnapshotGeneration((generation) => generation + 1);
  }, []);

  return (
    <SessionProvider
      basePath={API_ENDPOINTS.oauth}
      key={sessionSnapshotGeneration}
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
      session={sessionSnapshot}
    >
      {children}
      <SessionFreshnessPoller onReconcileSession={reconcileSession} />
      <UserUpdater />
    </SessionProvider>
  );
};

export default NextAuth;
