// @vitest-environment node
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generationUpdate = vi.fn();
const traceGeneration = vi.fn(() => ({
  id: 'generation-id',
  update: generationUpdate,
}));
const traceUpdate = vi.fn();
const createTrace = vi.fn(() => ({
  generation: traceGeneration,
  id: 'trace-id',
  update: traceUpdate,
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(() => ({
    createTrace,
    shutdownAsync: vi.fn(),
  })),
}));

import { createTraceOptions } from './trace';

describe('createTraceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards cache usage fields to the Langfuse generation', async () => {
    const payload = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'compatible-model',
    } as ChatStreamPayload;
    const { callback } = createTraceOptions(payload, {
      provider: 'openaicompatible',
      trace: { traceId: 'trace-id' },
    });

    await callback.onCompletion?.({
      text: 'Hello back',
      usage: {
        inputCacheMissTokens: 0,
        inputCachedTokens: 100,
        inputTextTokens: 100,
        inputWriteCacheTokens: 25,
        outputTextTokens: 10,
        totalInputTokens: 100,
        totalOutputTokens: 10,
        totalTokens: 110,
      },
    });

    expect(generationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        output: 'Hello back',
        usage: {
          completionTokens: 10,
          input: 100,
          inputCacheMissTokens: 0,
          inputCachedTokens: 100,
          inputWriteCacheTokens: 25,
          output: 10,
          promptTokens: 100,
          totalTokens: 110,
        },
      }),
    );
    expect(traceUpdate).toHaveBeenCalledWith({ output: 'Hello back' });
  });
});
