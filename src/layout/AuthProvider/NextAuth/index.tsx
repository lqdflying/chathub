import { SessionProvider } from 'next-auth/react';
import React, { PropsWithChildren } from 'react';

import { API_ENDPOINTS } from '@/services/_url';

import UserUpdater from './UserUpdater';

const NextAuth = ({ children }: PropsWithChildren) => {
  return (
    <SessionProvider
      basePath={API_ENDPOINTS.oauth}
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      {children}
      <UserUpdater />
    </SessionProvider>
  );
};

export default NextAuth;
