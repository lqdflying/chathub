'use client';

import { useSession } from 'next-auth/react';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { completeOwnedNextAuthSessionTransition } from '@/libs/next-auth/sessionLifecycle';
import { useUserStore } from '@/store/user';
import { LobeUser } from '@/types/user';

// update the user data into the context
const UserUpdater = memo(() => {
  const { data: session, status } = useSession();
  const isLoaded = status !== 'loading';

  const isSignedIn = (status === 'authenticated' && session && !!session.user) || false;

  const nextUser = session?.user;
  const useStoreUpdater = createStoreUpdater(useUserStore);

  useStoreUpdater('isLoaded', isLoaded);
  useStoreUpdater('isSignedIn', isSignedIn);
  useStoreUpdater('nextSession', session!);
  useStoreUpdater('authUserId', nextUser?.id);

  useEffect(() => {
    if (status !== 'loading') completeOwnedNextAuthSessionTransition();

    if (status === 'unauthenticated') {
      useUserStore.setState({
        authUserId: undefined,
        nextSession: undefined,
        nextUser: undefined,
        user: undefined,
      });
      return;
    }

    if (!nextUser) return;

    const userAvatar = useUserStore.getState().user?.avatar;
    const lobeUser = {
      avatar: userAvatar || '',
      email: nextUser.email,
      fullName: nextUser.name,
      id: nextUser.id,
    } as LobeUser;

    useUserStore.setState({ nextUser, user: lobeUser });
  }, [nextUser, status]);
  return null;
});

export default UserUpdater;
