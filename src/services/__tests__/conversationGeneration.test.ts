import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conversationGenerationService,
  tryEnqueueConversationGeneration,
} from '../conversationGeneration';

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({})),
}));

describe('tryEnqueueConversationGeneration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the operation when enqueue succeeds', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockResolvedValue({
      id: 'cgo_ok',
    } as any);

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-5-mini', provider: 'openai' },
        kind: 'chat',
      }),
    ).resolves.toEqual({ id: 'cgo_ok' });
  });

  it('swallows retryable enqueue failures after checking active operations', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      new Error('Durable conversation generation is disabled.'),
    );
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-5-mini', provider: 'openai' },
        kind: 'chat',
      }),
    ).resolves.toBeUndefined();
    expect(listActive).not.toHaveBeenCalled();
  });

  it('does not recover an arbitrary active lane after a transport failure', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      new Error('network error'),
    );
    const listActive = vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
      {
        groupId: null,
        id: 'cgo_active',
        kind: 'chat',
        sessionId: 'session-1',
        status: 'processing',
        topicId: 'topic-1',
      },
    ] as any);

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-5-mini', provider: 'openai' },
        kind: 'chat',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toBeUndefined();
    expect(listActive).not.toHaveBeenCalled();
  });

  it('falls back when the provider has no server-reachable credentials', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      new Error(
        'This model is configured to run in the browser and no server-reachable API credentials were found. Durable background generation requires a provider API key on the server.',
      ),
    );

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-5-mini', fetchOnClient: true, provider: 'openai' },
        kind: 'chat',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('conversationGenerationService.subscribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delivers a final reset frame without a trailing SSE delimiter', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('event: reset\ndata: {"reset":true}'));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    const onEvent = vi.fn();

    await conversationGenerationService.subscribe({ onEvent });

    expect(onEvent).toHaveBeenCalledWith({ reset: true, type: 'reset' });
  });
});
