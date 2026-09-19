import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { subscribeAccountScopeInvalidation } from '@/store/accountScopeInvalidation';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const isXaiOAuthQuery = (queryKey: unknown) =>
  Array.isArray(queryKey) && JSON.stringify(queryKey).includes('xaiOAuth');

export const useFetchXaiOAuthStatus = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const userStateScope = useUserStore((s) => s.userStateScope);
  const preferenceOwner = useUserStore(authSelectors.currentUserScope);
  const hasOwnerMismatch = useUserStore(authSelectors.hasActiveUserStateOwnerMismatch);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const updateXaiOAuthConnected = useAiInfraStore((s) => s.updateXaiOAuthConnected);
  const queryClient = useQueryClient();
  const canFetch =
    !!isLogin &&
    !!userStateScope &&
    !!preferenceOwner &&
    userStateScope === preferenceOwner &&
    isUserStateInit &&
    !hasOwnerMismatch;

  const query = lambdaQuery.xaiOAuth.status.useQuery(
    { accountScope: userStateScope ?? '' },
    { enabled: canFetch },
  );

  useEffect(() => {
    return subscribeAccountScopeInvalidation(() => {
      queryClient.removeQueries({
        predicate: (entry) => isXaiOAuthQuery(entry.queryKey),
      });
      updateXaiOAuthConnected(false);
    });
  }, [queryClient, updateXaiOAuthConnected]);

  useEffect(() => {
    if (!canFetch) {
      updateXaiOAuthConnected(false);
      return;
    }
    if (query.data) updateXaiOAuthConnected(!!query.data.connected);
  }, [canFetch, query.data, updateXaiOAuthConnected]);
};
