import { useCallback } from 'react';

import { INBOX_SESSION_ID } from '@/const/session';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { hasVerifiedAccountOwnership } from '@/store/accountMutation';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { getSessionStoreState } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { getUserStoreState } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useSwitchSession = () => {
  const togglePortal = useChatStore((s) => s.togglePortal);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const router = useQueryRoute();

  return useCallback(
    (id: string): boolean => {
      if (id !== INBOX_SESSION_ID) {
        const userState = getUserStoreState();
        const currentUserScope = authSelectors.currentUserScope(userState);
        const sessionState = getSessionStoreState();
        const isVerifiedCurrentAccount =
          !!currentUserScope && hasVerifiedAccountOwnership(userState, currentUserScope);
        const isKnownCurrentAccountSession =
          sessionSelectors.isSessionListInit(sessionState) &&
          !!sessionSelectors.getSessionById(id)(sessionState);

        if (!isVerifiedCurrentAccount || !isKnownCurrentAccountSession) return false;
      }

      togglePortal(false);

      router.push('/chat', {
        query: {
          session: id,
          ...(mobile ? { showMobileWorkspace: 'true' } : {}),
        },
      });

      return true;
    },
    [mobile, router, togglePortal],
  );
};
