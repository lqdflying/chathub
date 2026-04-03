import { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

export const GET = checkAuth(async (req, { params, jwtPayload }) => {
  const { provider } = await params;

  try {
    const agentRuntime = await initModelRuntimeWithUserPayload(provider, {
      ...jwtPayload,
    });

    const list = await agentRuntime.models();

    return NextResponse.json(list);
  } catch (e) {
    const chatError = e as ChatCompletionErrorPayload;

    // If the provider doesn't support listing models (e.g., MiniMax API doesn't have /models endpoint),
    // return an empty list so builtin models are still displayed
    const errorStatus = (chatError.error as any)?.status;
    if (errorStatus === 404) {
      console.error('Route:', provider, '404 (provider may not support /models endpoint):', chatError.error);
      return NextResponse.json([]);
    }

    const { errorType: et, error: errorContent, ...res } = chatError;
    const error = errorContent || e;
    // track the error at server side
    console.error('Route:', provider, et, error);

    return createErrorResponse(et || ChatErrorType.InternalServerError, {
      error,
      ...res,
      provider,
    });
  }
});
