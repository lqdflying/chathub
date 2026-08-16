import { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { LOBE_CHAT_AUTH_HEADER } from '@/const/auth';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { lambdaRouter } from '@/server/routers/lambda';
import { createErrorResponse } from '@/utils/errorResponse';

export const runtime = 'nodejs';
export const maxDuration = 60;

// The in-chat Image tool's entry point. This does NOT generate synchronously —
// image generation can take 30–60 s and a request held open that long dies at
// proxies/CDNs. It creates an async generation task (the same pattern the
// Image workspace uses) and returns its id immediately; the client polls
// `image.getChatImageResult` for the outcome.
//
// Two deliberate details:
// - It lives under /create-chat-image (NOT /create-image) so the static
//   /create-image/comfyui route can never shadow a provider segment.
// - It exists as a webapi route (rather than a direct lambda call) because the
//   client must send the auth payload scoped to the IMAGE provider
//   (`createHeaderWithAuth(provider)`), and the caller context must forward
//   the RAW encoded header — image procedures run the keyVaults middleware,
//   which decodes `ctx.authorizationHeader` itself.
export const POST = checkAuth(async (req: Request, { params, jwtPayload }) => {
  const { provider } = await params;

  try {
    const body = (await req.json()) as { model: string; params: { prompt: string } };

    const createCaller = createCallerFactory(lambdaRouter);
    const caller = createCaller({
      authorizationHeader: req.headers.get(LOBE_CHAT_AUTH_HEADER),
      jwtPayload,
      nextAuth: undefined,
      userId: jwtPayload?.userId,
    } as any);

    const result = await caller.image.createChatImage({
      model: body.model,
      params: body.params,
      provider,
    });

    return NextResponse.json(result);
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    console.error('Route: create-chat-image', provider, errorType, error);

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
