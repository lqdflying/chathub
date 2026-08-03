import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

import type { EdgeRouter } from '@/server/routers/edge';

export const edgeClient = createTRPCClient<EdgeRouter>({
  links: [
    httpBatchLink({
      headers: async () => {
        // dynamic import to avoid circular dependency
        const { createHeaderWithAuth } = await import('@/services/_auth');

        return createHeaderWithAuth();
      },
      maxURLLength: 2083,
      transformer: superjson,
      url: '/trpc/edge',
    }),
  ],
});
