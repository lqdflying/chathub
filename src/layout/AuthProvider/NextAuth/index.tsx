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

  const reconcileSession = useCallback((nextSession: Session | null) => {
    setSessionSnapshot(nextSession);
  }, []);

  // next-auth's SessionProvider captures `session` in a lazy useState once and never syncs
  // later prop changes. Remount it when the session *identity* changes (login/logout/account
  // switch) — the only case reconcileSession fires — so reconciliation reaches useSession()
  // consumers without remounting the app tree on every poll. Keep "no session" distinct from
  // "session without a user id" so a logout from an id-less session still forces a remount.
  const sessionIdentity = sessionSnapshot
    ? `user:${sessionSnapshot.user?.id ?? 'unknown'}`
    : 'anonymous';

  return (
    <SessionProvider
      basePath={API_ENDPOINTS.oauth}
      key={sessionIdentity}
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
