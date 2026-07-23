import type { ContextExportRequestSnapshot } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  createContextExportCaptureBridge,
  prependContextSnapshotToResponse,
} from './contextExportResponse';

const snapshot: ContextExportRequestSnapshot = {
  captureId: 'capture-1',
  continuationReason: 'initial',
  engineeredInput: { messages: [{ content: 'hello', role: 'user' }] },
  metadata: {
    apiMode: 'responses',
    model: 'test-model',
    provider: 'test-provider',
  },
  providerRequest: { input: 'hello' },
  purpose: 'assistant',
  redactions: ['transportOptions'],
  requestId: 'request-1',
  sequence: 0,
  status: 'complete',
};

describe('createContextExportCaptureBridge', () => {
  it('captures and sanitizes only the first prepared request', async () => {
    const sanitize = vi.fn((value: unknown) => ({
      sanitized: String((value as { input: string }).input),
    }));
    const bridge = createContextExportCaptureBridge(sanitize);

    expect(bridge.getSnapshot()).toBeUndefined();

    bridge.onRequestPrepared({ input: 'first' }, { apiMode: 'responses' });
    bridge.onRequestPrepared({ input: 'second' }, { apiMode: 'chatCompletion' });

    expect(bridge.getSnapshot()).toEqual({
      apiMode: 'responses',
      providerRequest: { sanitized: 'first' },
    });
    await expect(bridge.snapshot).resolves.toEqual({
      apiMode: 'responses',
      providerRequest: { sanitized: 'first' },
    });
    expect(sanitize).toHaveBeenCalledOnce();
  });
});

describe('prependContextSnapshotToResponse', () => {
  it('emits the snapshot before the first upstream event', async () => {
    const upstreamBody = 'event: text\ndata: "hello"\n\n';
    const response = new Response(upstreamBody, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const wrappedResponse = prependContextSnapshotToResponse(response, Promise.resolve(snapshot));
    const body = await wrappedResponse.text();

    expect(body).toBe(
      `event: context_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n${upstreamBody}`,
    );
  });

  it('closes without hanging when dispatch never produced a snapshot', async () => {
    const neverResolvedSnapshot = new Promise<ContextExportRequestSnapshot>(() => {});
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    );

    const wrappedResponse = prependContextSnapshotToResponse(response, neverResolvedSnapshot);

    await expect(wrappedResponse.text()).resolves.toBe('');
  });

  it('propagates an upstream stream error before request preparation', async () => {
    const neverResolvedSnapshot = new Promise<ContextExportRequestSnapshot>(() => {});
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('dispatch failed'));
        },
      }),
    );

    const wrappedResponse = prependContextSnapshotToResponse(response, neverResolvedSnapshot);

    await expect(wrappedResponse.text()).rejects.toThrow('dispatch failed');
  });
});
