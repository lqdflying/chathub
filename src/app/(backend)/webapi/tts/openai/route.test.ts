// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { createOpenaiAudioSpeech } from '@lobehub/tts/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuthFromHeader } from '@/app/(backend)/middleware/auth/utils';
import { OAUTH_AUTHORIZED } from '@/const/auth';

import { createOpenAIAudioClient } from '../../openaiAudio';
import { POST } from './route';

vi.mock('@lobehub/tts/server', () => ({
  createOpenaiAudioSpeech: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/(backend)/middleware/auth/utils')>()),
  resolveWebApiAuthFromHeader: vi.fn(),
}));

vi.mock('../../openaiAudio', () => ({
  createOpenAIAudioClient: vi.fn(),
}));

describe('POST /webapi/tts/openai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a forged OAuth marker before parsing input or creating an OpenAI client', async () => {
    const parseBody = vi.fn();
    vi.mocked(resolveWebApiAuthFromHeader).mockRejectedValue(
      AgentRuntimeError.createError(ChatErrorType.Unauthorized),
    );
    const request = {
      headers: new Headers({ [OAUTH_AUTHORIZED]: 'true' }),
      json: parseBody,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(parseBody).not.toHaveBeenCalled();
    expect(createOpenAIAudioClient).not.toHaveBeenCalled();
    expect(createOpenaiAudioSpeech).not.toHaveBeenCalled();
  });

  it('uses the authenticated payload after route-boundary authorization succeeds', async () => {
    const authenticatedPayload = {
      apiKey: 'client-api-key',
      baseURL: 'https://openai.example/v1',
    };
    const openaiClient = { audio: {} };
    const speechResponse = new Response('audio');
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'nextAuth', userId: 'account-a' },
      payload: authenticatedPayload,
    });
    vi.mocked(createOpenAIAudioClient).mockReturnValue(openaiClient as never);
    vi.mocked(createOpenaiAudioSpeech).mockResolvedValue(speechResponse);
    const request = new Request('https://chathub.example/webapi/tts/openai', {
      body: JSON.stringify({ input: 'hello', model: 'tts-1', voice: 'alloy' }),
      method: 'POST',
    });

    const response = await POST(request);

    expect(resolveWebApiAuthFromHeader).toHaveBeenCalledWith(request, {
      allowProviderApiKey: true,
    });
    expect(createOpenAIAudioClient).toHaveBeenCalledWith(authenticatedPayload);
    expect(createOpenaiAudioSpeech).toHaveBeenCalledWith({
      openai: openaiClient,
      payload: { input: 'hello', model: 'tts-1', voice: 'alloy' },
    });
    expect(response).toBe(speechResponse);
  });
});
