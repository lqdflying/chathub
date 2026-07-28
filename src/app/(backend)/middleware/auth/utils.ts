import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, type ClientSecretPayload } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { NextRequest } from 'next/server';

import { LOBE_CHAT_AUTH_HEADER, enableClerk, enableNextAuth, enableTokenAuth } from '@/const/auth';
import { getAppConfig } from '@/envs/app';
import { ClerkAuth } from '@/libs/clerk-auth';
import { resolveTokenAuthUserId } from '@/libs/tokenAuth';
import { createErrorResponse } from '@/utils/errorResponse';

interface CheckAuthParams {
  accessCode?: string;
  apiKey?: string;
  clerkUserId?: null | string;
  nextAuthUserId?: null | string;
  tokenAuthUserId?: string;
}

export type AuthMethodResult =
  | {
      method: 'clerk' | 'nextAuth' | 'tokenAuth';
      userId: string;
    }
  | {
      method: 'accessCode' | 'apiKey' | 'none';
    };

export interface WebApiRequestAuth {
  authResult: AuthMethodResult;
  payload: ClientSecretPayload;
}

interface WebApiRequestAuthOptions {
  allowProviderApiKey?: boolean;
}

/**
 * Check if a resolved server identity, user API key, or access code authorizes the request.
 *
 * Configured server authentication is authoritative. Payload credentials are considered only when
 * Clerk, NextAuth, and static bearer authentication are all disabled.
 */
export const checkAuthMethod = ({
  apiKey,
  nextAuthUserId,
  tokenAuthUserId,
  accessCode,
  clerkUserId,
}: CheckAuthParams): AuthMethodResult => {
  if (enableClerk && clerkUserId) return { method: 'clerk', userId: clerkUserId };
  if (enableNextAuth && nextAuthUserId) return { method: 'nextAuth', userId: nextAuthUserId };
  if (enableTokenAuth && tokenAuthUserId) return { method: 'tokenAuth', userId: tokenAuthUserId };

  if (enableClerk || enableNextAuth || enableTokenAuth) {
    throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);
  }

  if (apiKey) return { method: 'apiKey' };

  const { ACCESS_CODES } = getAppConfig();

  if (!ACCESS_CODES.length) return { method: 'none' };

  if (!accessCode || !ACCESS_CODES.includes(accessCode)) {
    console.warn('tracked an invalid access code, 检查到输入的错误密码：', accessCode);
    throw AgentRuntimeError.createError(ChatErrorType.InvalidAccessCode);
  }

  return { method: 'accessCode' };
};

export const resolveWebApiAuth = async (
  request: Request,
  payload: Pick<ClientSecretPayload, 'accessCode' | 'apiKey'>,
): Promise<AuthMethodResult> => {
  let clerkUserId: null | string | undefined;
  if (enableClerk) {
    const clerkAuth = new ClerkAuth();
    clerkUserId = clerkAuth.getAuthFromRequest(request as NextRequest).userId;
  }

  let nextAuthUserId: null | string | undefined;
  if (enableNextAuth) {
    const { default: NextAuth } = await import('@/libs/next-auth');
    const session = await NextAuth.auth();
    nextAuthUserId = session?.user?.id;
  }

  return checkAuthMethod({
    accessCode: payload.accessCode,
    apiKey: payload.apiKey,
    clerkUserId,
    nextAuthUserId,
    tokenAuthUserId: resolveTokenAuthUserId(request.headers),
  });
};

export const resolveWebApiAuthFromHeader = async (
  request: Request,
  options: WebApiRequestAuthOptions = {},
): Promise<WebApiRequestAuth> => {
  const encodedPayload = request.headers.get(LOBE_CHAT_AUTH_HEADER);
  const payload: ClientSecretPayload = encodedPayload ? getXorPayload(encodedPayload) : {};
  const authResult = await resolveWebApiAuth(request, {
    accessCode: payload.accessCode,
    apiKey: options.allowProviderApiKey ? payload.apiKey : undefined,
  });

  return { authResult, payload };
};

export const createWebApiAuthErrorResponse = (error: unknown): Response => {
  const errorType =
    (error as { errorType?: ChatErrorType }).errorType ?? ChatErrorType.Unauthorized;

  return createErrorResponse(errorType, error);
};
