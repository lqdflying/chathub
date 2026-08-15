import { ChatCompletionErrorPayload, CreateImagePayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

export const preferredRegion = [
  'arn1',
  'bom1',
  'cdg1',
  'cle1',
  'cpt1',
  'dub1',
  'fra1',
  'gru1',
  'hnd1',
  'iad1',
  'icn1',
  'kix1',
  'lhr1',
  'pdx1',
  'sfo1',
  'sin1',
  'syd1',
];

// The modern, provider-agnostic image endpoint. Unlike /webapi/text-to-image
// (legacy `agentRuntime.textToImage` → string[] URLs, OpenAI-only), this calls
// `agentRuntime.createImage` so the built-in Image tool can use whatever image
// model/provider the user configured (gpt-image-1, dall-e-3, flux, …), the same
// primitive the main Image workspace uses.
export const POST = checkAuth(async (req: Request, { params, jwtPayload }) => {
  const { provider } = await params;

  try {
    const agentRuntime = await initModelRuntimeWithUserPayload(provider, jwtPayload);

    const data = (await req.json()) as CreateImagePayload;

    if (!agentRuntime.createImage) {
      throw new Error(`Provider "${provider}" does not support image creation.`);
    }

    const image = await agentRuntime.createImage(data);

    return NextResponse.json(image);
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    // track the error at server side
    console.error('Route:', provider, errorType, error);

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
