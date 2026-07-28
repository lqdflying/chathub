import type { NextRequest } from 'next/server';

import NextAuthNode from '@/libs/next-auth';
import {
  SESSION_REFRESH_HEADER,
  SESSION_REFRESH_HEADER_VALUE,
} from '@/libs/next-auth/sessionConstants';
import { stripAuthJsSessionCookies } from '@/libs/next-auth/sessionCookies';

const isSessionRequest = (request: NextRequest): boolean =>
  request.nextUrl.pathname.endsWith('/session');

const shouldRefreshSession = (request: NextRequest): boolean =>
  isSessionRequest(request) &&
  request.headers.get(SESSION_REFRESH_HEADER) === SESSION_REFRESH_HEADER_VALUE;

export const GET = async (request: NextRequest) => {
  const response = await NextAuthNode.handlers.GET(request);

  if (!isSessionRequest(request) || shouldRefreshSession(request)) return response;

  return stripAuthJsSessionCookies(response);
};

export const { POST } = NextAuthNode.handlers;
