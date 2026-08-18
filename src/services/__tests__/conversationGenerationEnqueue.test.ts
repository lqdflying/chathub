import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationGenerationService, tryEnqueueConversationGeneration } from '../conversationGeneration';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    conversationGeneration: {
      enqueue: { mutate: vi.fn() },
      getOperationByIdempotencyKey: { query: vi.fn() },
      listActive: { query: vi.fn() },
    },
  },
}));

describe('tryEnqueueConversationGeneration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not recover a stale lane after UNPROCESSABLE_CONTENT', async () => {
    const listActive = vi
      .spyOn(conversationGenerationService, 'listActive')
      .mockResolvedValue([{ id: 'cgo_stale', kind: 'chat', status: 'processing' }] as any);
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      Object.assign(new TRPCClientError('Durable generation deferred to the browser'), {
        data: { code: 'UNPROCESSABLE_CONTENT' },
      }),
    );

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-4o', provider: 'openai' } as any,
        kind: 'regenerate',
        sessionId: 's1',
        topicId: 't1',
      }),
    ).resolves.toBeUndefined();
    expect(listActive).not.toHaveBeenCalled();
  });

  it('recovers only by idempotency key after a transport failure', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(new Error('network down'));
    const recovered = { id: 'cgo_same', kind: 'chat', status: 'pending' };
    const byKey = vi
      .spyOn(conversationGenerationService, 'getOperationByIdempotencyKey')
      .mockResolvedValue(recovered as any);
    const listActive = vi.spyOn(conversationGenerationService, 'listActive');

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-4o', provider: 'openai' } as any,
        idempotencyKey: 'chat-send:temp',
        kind: 'chat',
        sessionId: 's1',
      }),
    ).resolves.toEqual(recovered);
    expect(byKey).toHaveBeenCalledWith('chat-send:temp');
    expect(listActive).not.toHaveBeenCalled();
  });
});
