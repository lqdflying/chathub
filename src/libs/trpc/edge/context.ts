import { ClientSecretPayload } from '@lobechat/types';
import { User } from 'next-auth';
import { NextRequest } from 'next/server';

import { LOBE_CHAT_AUTH_HEADER, enableClerk, enableNextAuth, enableTokenAuth } from '@/const/auth';
import { ClerkAuth, IClerkAuth } from '@/libs/clerk-auth';
import { resolveTokenAuthUserId } from '@/libs/tokenAuth';

export interface AuthContext {
  authorizationHeader?: string | null;
  clerkAuth?: IClerkAuth;
  jwtPayload?: ClientSecretPayload | null;
  nextAuth?: User;
  rawAuthUserId?: string | null;
  userId?: string | null;
}

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createContextInner = async (params?: {
  authorizationHeader?: string | null;
  clerkAuth?: IClerkAuth;
  nextAuth?: User;
  rawAuthUserId?: string | null;
  userId?: string | null;
}): Promise<AuthContext> => ({
  authorizationHeader: params?.authorizationHeader,
  clerkAuth: params?.clerkAuth,
  nextAuth: params?.nextAuth,
  rawAuthUserId: params?.rawAuthUserId,
  userId: params?.userId,
});

export type EdgeContext = Awaited<ReturnType<typeof createContextInner>>;

/**
 * Creates context for an incoming request
 * @link https://trpc.io/docs/v11/context
 */
export const createEdgeContext = async (request: NextRequest): Promise<EdgeContext> => {
  // for API-response caching see https://trpc.io/docs/v11/caching

  const authorization = request.headers.get(LOBE_CHAT_AUTH_HEADER);

  let userId;
  let auth;

  // Token-based auth (static bearer token, no OAuth required)
  if (enableTokenAuth) {
    const tokenAuthUserId = resolveTokenAuthUserId(request.headers);
    if (tokenAuthUserId) {
      return createContextInner({
        authorizationHeader: authorization,
        rawAuthUserId: tokenAuthUserId,
        userId: tokenAuthUserId,
      });
    }
  }

  if (enableClerk) {
    const clerkAuth = new ClerkAuth();
    const result = clerkAuth.getAuthFromRequest(request);
    auth = result.clerkAuth;
    userId = result.userId;

    return createContextInner({
      authorizationHeader: authorization,
      clerkAuth: auth,
      rawAuthUserId: userId,
      userId,
    });
  }

  if (enableNextAuth) {
    try {
      const { default: NextAuth } = await import('@/libs/next-auth');

      const session = await NextAuth.auth();
      if (session && session?.user?.id) {
        auth = session.user;
        userId = session.user.id;
      }
      return createContextInner({
        authorizationHeader: authorization,
        nextAuth: auth,
        rawAuthUserId: userId,
        userId,
      });
    } catch (e) {
      console.error('next auth err', e);
    }
  }

  return createContextInner({ authorizationHeader: authorization, userId });
};
