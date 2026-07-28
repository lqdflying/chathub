import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import type { AuthContext } from '@/libs/trpc/lambda/context';

import { trpc } from '../init';
import { resolveAuthenticatedAccountScope, verifiedAccountScope } from './verifiedAccountScope';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const appRouter = trpc.router({
  sensitiveQuery: trpc.procedure.use(verifiedAccountScope).query(({ ctx }) => {
    return ctx.verifiedAccountScope;
  }),
});
const createCaller = createCallerFactory(appRouter);

describe('verifiedAccountScope middleware', () => {
  it.each([
    ['missing', undefined],
    ['guest', 'guest'],
    ['foreign', 'user:account-b'],
  ])('rejects a %s account scope claim', async (_caseName, accountScope) => {
    const caller = createCaller({
      accountScope,
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as AuthContext);

    await expect(caller.sensitiveQuery()).rejects.toEqual(
      new TRPCError({
        code: 'FORBIDDEN',
        message: 'Account scope does not match the authenticated user',
      }),
    );
  });

  it('compares the claim with the raw authenticated owner instead of the mapped database owner', async () => {
    const caller = createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'mapped-database-owner',
    } as AuthContext);

    await expect(caller.sensitiveQuery()).resolves.toBe('user:account-a');
  });

  it('uses the authenticated context user for token-authenticated requests', () => {
    expect(
      resolveAuthenticatedAccountScope(
        {
          userId: 'token-account',
        },
        true,
      ),
    ).toBe('user:token-account');
  });

  it('permits only the local scope when authentication is disabled', () => {
    expect(resolveAuthenticatedAccountScope({}, false)).toBe('local');
  });
});
