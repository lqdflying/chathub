import { useEffect } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useFetchOpenAICodexStatus = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const updateOpenAICodexConnected = useAiInfraStore((s) => s.updateOpenAICodexConnected);
  const query = lambdaQuery.openaiCodex.status.useQuery(undefined, {
    enabled: !!isLogin,
  });

  useEffect(() => {
    if (!isLogin) {
      updateOpenAICodexConnected(false);
      return;
    }
    if (query.data) updateOpenAICodexConnected(!!query.data.connected);
  }, [isLogin, query.data, updateOpenAICodexConnected]);
};
