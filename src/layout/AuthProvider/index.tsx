import type { Session } from 'next-auth';
import { PropsWithChildren } from 'react';

import { authEnv } from '@/envs/auth';

import Clerk from './Clerk';
import NextAuth from './NextAuth';
import NoAuth from './NoAuth';

interface AuthProviderProps extends PropsWithChildren {
  initialNextAuthSession: Session | null;
}

const AuthProvider = ({ children, initialNextAuthSession }: AuthProviderProps) => {
  if (authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH) return <Clerk>{children}</Clerk>;

  if (authEnv.NEXT_PUBLIC_ENABLE_NEXT_AUTH)
    return <NextAuth initialSession={initialNextAuthSession}>{children}</NextAuth>;

  return <NoAuth>{children}</NoAuth>;
};

export default AuthProvider;
