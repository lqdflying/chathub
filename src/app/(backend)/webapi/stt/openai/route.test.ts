// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { createOpenaiAudioTranscriptions } from '@lobehub/tts/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuthFromHeader } from '@/app/(backend)/middleware/auth/utils';
import { OAUTH_AUTHORIZED } from '@/const/auth';

import { createOpenAIAudioClient } from '../../openaiAudio';
import { POST } from './route';

vi.mock('@lobehub/tts/server', () => ({
  createOpenaiAudioTranscriptions: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/(backend)/middleware/auth/utils')>()),
  resolveWebApiAuthFromHeader: vi.fn(),
}));

vi.mock('../../openaiAudio', () => ({
  createOpenAIAudioClient: vi.fn(),
}));

describe('POST /webapi/stt/openai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a forged OAuth marker before parsing input or creating an OpenAI client', async () => {
    const parseFormData = vi.fn();
    vi.mocked(resolveWebApiAuthFromHeader).mockRejectedValue(
      AgentRuntimeError.createError(ChatErrorType.Unauthorized),
    );
    const request = {
      formData: parseFormData,
      headers: new Headers({ [OAUTH_AUTHORIZED]: 'true' }),
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(parseFormData).not.toHaveBeenCalled();
    expect(createOpenAIAudioClient).not.toHaveBeenCalled();
    expect(createOpenaiAudioTranscriptions).not.toHaveBeenCalled();
  });

  it('uses the authenticated payload after route-boundary authorization succeeds', async () => {
    const authenticatedPayload = {
      apiKey: 'client-api-key',
      baseURL: 'https://openai.example/v1',
    };
    const openaiClient = { audio: {} };
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'tokenAuth', userId: 'account-a' },
      payload: authenticatedPayload,
    });
    vi.mocked(createOpenAIAudioClient).mockReturnValue(openaiClient as never);
    vi.mocked(createOpenaiAudioTranscriptions).mockResolvedValue({ text: 'hello' });
    const formData = new FormData();
    const speech = new Blob(['audio'], { type: 'audio/webm' });
    formData.set('options', JSON.stringify({ model: 'whisper-1' }));
    formData.set('speech', speech);
    const request = new Request('https://chathub.example/webapi/stt/openai', {
      body: formData,
      method: 'POST',
    });

    const response = await POST(request);

    expect(resolveWebApiAuthFromHeader).toHaveBeenCalledWith(request, {
      allowProviderApiKey: true,
    });
    expect(createOpenAIAudioClient).toHaveBeenCalledWith(authenticatedPayload);
    expect(createOpenaiAudioTranscriptions).toHaveBeenCalledWith({
      openai: openaiClient,
      payload: {
        options: { model: 'whisper-1' },
        speech: expect.any(Blob),
      },
    });
    await expect(response.json()).resolves.toEqual({ text: 'hello' });
  });
});
