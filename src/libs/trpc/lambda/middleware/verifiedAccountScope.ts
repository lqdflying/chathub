import { TRPCError } from '@trpc/server';

import { enableAuth } from '@/const/auth';

import type { LambdaContext } from '../context';
import { trpc } from '../init';

export const resolveAuthenticatedAccountScope = (
  context: LambdaContext,
  authenticationEnabled: boolean = enableAuth,
): string | undefined => {
  if (!authenticationEnabled) return 'local';

  const authenticatedUserId =
    context.clerkAuth?.userId ??
    context.nextAuth?.id ??
    context.oidcAuth?.sub ??
    context.userId ??
    undefined;

  return authenticatedUserId ? `user:${authenticatedUserId}` : undefined;
};

export const verifiedAccountScope = trpc.middleware((options) => {
  const expectedAccountScope = resolveAuthenticatedAccountScope(options.ctx);

  if (!expectedAccountScope || options.ctx.accountScope !== expectedAccountScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
  }

  return options.next({
    ctx: {
      verifiedAccountScope: expectedAccountScope,
    },
  });
});
