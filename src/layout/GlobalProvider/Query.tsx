'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { PropsWithChildren, useState } from 'react';

import { useFetchOpenAICodexStatus } from '@/hooks/useFetchOpenAICodexStatus';
import { useFetchXaiOAuthStatus } from '@/hooks/useFetchXaiOAuthStatus';
import { lambdaQuery, lambdaQueryClient } from '@/libs/trpc/client';

const ProviderOAuthStatusBridge = () => {
  useFetchOpenAICodexStatus();
  useFetchXaiOAuthStatus();
  return null;
};

const QueryProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => new QueryClient());
  // Cast required because pnpm installs separate QueryClient type instances for trpc and app
  const providerQueryClient = queryClient as unknown as React.ComponentProps<
    typeof lambdaQuery.Provider
  >['queryClient'];

  return (
    <lambdaQuery.Provider client={lambdaQueryClient} queryClient={providerQueryClient}>
      <QueryClientProvider client={queryClient}>
        <ProviderOAuthStatusBridge />
        {children}
      </QueryClientProvider>
    </lambdaQuery.Provider>
  );
};

export default QueryProvider;
