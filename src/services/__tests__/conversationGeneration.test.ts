import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conversationGenerationService,
  tryEnqueueConversationGeneration,
} from '../conversationGeneration';

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
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([]);

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-5-mini', provider: 'openai' },
        kind: 'chat',
      }),
    ).resolves.toBeUndefined();
  });

  it('recovers an active operation when enqueue fails transiently', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      new Error('network error'),
    );
    vi.spyOn(conversationGenerationService, 'listActive').mockResolvedValue([
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
    ).resolves.toEqual(expect.objectContaining({ id: 'cgo_active' }));
  });

  it('does not fall back when the provider has no server-reachable credentials', async () => {
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
    ).rejects.toThrow(/provider API key on the server/);
  });
});
