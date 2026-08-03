import { TRPCError } from '@trpc/server';

import { enableClerk } from '@/const/auth';

import { trpc } from '../lambda/init';

export const userAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  // `ctx.user` is nullable
  if (!ctx.userId) {
    if (enableClerk) {
      console.log('clerk auth:', ctx.clerkAuth);
    } else {
      console.log('next auth:', ctx.nextAuth);
    }
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return opts.next({
    // ✅ user value is known to be non-null now
    ctx: { userId: ctx.userId },
  });
});
