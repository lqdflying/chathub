import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  conversationGenerationService,
  tryEnqueueConversationGeneration,
  waitForConversationGeneration,
} from '../conversationGeneration';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    conversationGeneration: {
      enqueue: { mutate: vi.fn() },
      getOperation: { query: vi.fn() },
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
    ).resolves.toEqual({
      deferred: true,
      reason: 'unsupported_tool',
    });
    expect(listActive).not.toHaveBeenCalled();
  });

  it('returns a fetch_on_client deferral after PRECONDITION_FAILED', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      Object.assign(
        new TRPCClientError('No server-reachable credentials were found for provider "openai".'),
        { data: { code: 'PRECONDITION_FAILED' } },
      ),
    );

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-4o', provider: 'openai' } as any,
        kind: 'chat',
        sessionId: 's1',
      }),
    ).resolves.toEqual({
      deferred: true,
      reason: 'fetch_on_client',
    });
  });

  it('extracts the deferred tool name from UNPROCESSABLE_CONTENT', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      Object.assign(
        new TRPCClientError(
          'Durable generation deferred to the browser for "lobe-code-interpreter": browser runtime required',
        ),
        { data: { code: 'UNPROCESSABLE_CONTENT' } },
      ),
    );

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-4o', provider: 'openai' } as any,
        kind: 'chat',
        sessionId: 's1',
      }),
    ).resolves.toEqual({
      deferred: true,
      reason: 'unsupported_tool',
      toolName: 'lobe-code-interpreter',
    });
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

  it('does not recover a typed CONFLICT by idempotency key', async () => {
    vi.spyOn(conversationGenerationService, 'enqueue').mockRejectedValue(
      Object.assign(new TRPCClientError('A generation is already running for this conversation.'), {
        data: { code: 'CONFLICT' },
      }),
    );
    const byKey = vi
      .spyOn(conversationGenerationService, 'getOperationByIdempotencyKey')
      .mockResolvedValue({ id: 'cgo_other', kind: 'chat', status: 'succeeded' } as any);

    await expect(
      tryEnqueueConversationGeneration({
        config: { model: 'gpt-4o', provider: 'openai' } as any,
        idempotencyKey: 'regenerate:msg:req-new',
        kind: 'regenerate',
        sessionId: 's1',
      }),
    ).resolves.toBeUndefined();
    expect(byKey).not.toHaveBeenCalled();
  });
});

describe('waitForConversationGeneration', () => {
  it('returns once the operation is no longer active', async () => {
    vi.spyOn(conversationGenerationService, 'getOperation')
      .mockResolvedValueOnce({ id: 'cgo_wait', status: 'processing' } as any)
      .mockResolvedValueOnce({ id: 'cgo_wait', status: 'succeeded' } as any);

    await expect(waitForConversationGeneration('cgo_wait', { intervalMs: 1 })).resolves.toEqual(
      expect.objectContaining({ id: 'cgo_wait', status: 'succeeded' }),
    );
  });
});
