import { ChatErrorType } from '@lobechat/types';
import { OpenAITTSPayload } from '@lobehub/tts';
import { createOpenaiAudioSpeech } from '@lobehub/tts/server';

import {
  createWebApiAuthErrorResponse,
  resolveWebApiAuthFromHeader,
} from '@/app/(backend)/middleware/auth/utils';
import { createErrorResponse } from '@/utils/errorResponse';

import { createOpenAIAudioClient } from '../../openaiAudio';

export const runtime = 'edge';

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

export const POST = async (req: Request) => {
  let openai;

  try {
    const { payload } = await resolveWebApiAuthFromHeader(req, {
      allowProviderApiKey: true,
    });
    openai = createOpenAIAudioClient(payload);
  } catch (error) {
    if ((error as { errorType?: ChatErrorType }).errorType) {
      return createWebApiAuthErrorResponse(error);
    }

    return createErrorResponse(ChatErrorType.InternalServerError, error);
  }

  const payload = (await req.json()) as OpenAITTSPayload;

  return await createOpenaiAudioSpeech({ openai, payload });
};
