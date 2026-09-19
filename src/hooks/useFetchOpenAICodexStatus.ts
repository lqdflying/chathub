import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { subscribeAccountScopeInvalidation } from '@/store/accountScopeInvalidation';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const isOpenAICodexQuery = (queryKey: unknown) =>
  Array.isArray(queryKey) && JSON.stringify(queryKey).includes('openaiCodex');

export const useFetchOpenAICodexStatus = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userStateScope = useUserStore((s) => s.userStateScope);
  const preferenceOwner = useUserStore(authSelectors.currentUserScope);
  const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const updateOpenAICodexConnected = useAiInfraStore((s) => s.updateOpenAICodexConnected);
  const queryClient = useQueryClient();
  const canFetch =
    !!isLogin &&
    !!userStateScope &&
    !!preferenceOwner &&
    userStateScope === preferenceOwner &&
    isUserStateInit &&
    !hasOwnerMismatch;

  const query = lambdaQuery.openaiCodex.status.useQuery(
    { accountScope: userStateScope ?? '' },
    { enabled: canFetch },
  );

  useEffect(() => {
    return subscribeAccountScopeInvalidation(() => {
      queryClient.removeQueries({
        predicate: (entry) => isOpenAICodexQuery(entry.queryKey),
      });
      updateOpenAICodexConnected(false);
    });
  }, [queryClient, updateOpenAICodexConnected]);

  useEffect(() => {
    if (!canFetch) {
      updateOpenAICodexConnected(false);
      return;
    }
    if (query.data) updateOpenAICodexConnected(!!query.data.connected);
  }, [canFetch, query.data, updateOpenAICodexConnected]);
};
