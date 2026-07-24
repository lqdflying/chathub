import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWithImageDebugContext } from '@/libs/logger/imageDebug';

import { createImageDiagnosticFetch } from './imageDiagnosticFetch';

describe('createImageDiagnosticFetch', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalDebug: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.CHATHUB_IMAGE_DEBUG;
    originalKey = process.env.KEY_VAULTS_SECRET;
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-image-debug-secret';
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalDebug === undefined) delete process.env.CHATHUB_IMAGE_DEBUG;
    else process.env.CHATHUB_IMAGE_DEBUG = originalDebug;
    if (originalKey === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = originalKey;
    vi.restoreAllMocks();
  });

  it('inspects a response without consuming it', async () => {
    const sourceResponse = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    const cloneSpy = vi.spyOn(sourceResponse, 'clone');
    const fetchImpl = vi.fn(
      async () => sourceResponse,
    );
    const guardedFetch = createImageDiagnosticFetch(fetchImpl as typeof fetch);

    const response = await runWithImageDebugContext({ diagnosticId: 'ig_1234567890abcdef' }, () =>
      guardedFetch('https://internal.example.com/trpc/async'),
    );

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(sourceResponse.bodyUsed).toBe(true);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[chathub-image-debug:dispatch_settled]',
      expect.stringContaining('"bodyKind":"json"'),
    );
  });

  it('consumes a large streamed JSON response once without cloning it', async () => {
    const bodyText = JSON.stringify({ private: 'x'.repeat(300 * 1024) });
    let pullCount = 0;
    const sourceResponse = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          controller.enqueue(new TextEncoder().encode(bodyText));
          controller.close();
        },
      }),
      {
        headers: { 'content-type': 'application/json' },
        status: 200,
      },
    );
    const cloneSpy = vi.spyOn(sourceResponse, 'clone');
    const guardedFetch = createImageDiagnosticFetch(
      vi.fn(async () => sourceResponse) as unknown as typeof fetch,
    );

    const response = await runWithImageDebugContext(
      { diagnosticId: 'ig_1234567890abcdef' },
      () => guardedFetch('https://internal.example.com/trpc/async'),
    );

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ private: 'x'.repeat(300 * 1024) });
    expect(pullCount).toBe(1);
    expect(cloneSpy).not.toHaveBeenCalled();

    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(
      records.some(
        (record) =>
          record.response?.bodyKind === 'json' &&
          record.response?.fingerprintTruncated === true,
      ),
    ).toBe(true);
    expect(JSON.stringify(records)).not.toContain('x'.repeat(64));
  });

  it('logs HTML parse failures without logging the body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<!DOCTYPE html><body>private</body>', {
          headers: { 'content-type': 'text/html' },
          status: 502,
        }),
    );
    const guardedFetch = createImageDiagnosticFetch(fetchImpl as typeof fetch);

    const response = await runWithImageDebugContext({ diagnosticId: 'ig_1234567890abcdef' }, () =>
      guardedFetch('https://internal.example.com/trpc/async'),
    );

    await expect(response.json()).rejects.toThrow();
    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(records.some((record) => record.response?.bodyKind === 'html')).toBe(true);
    const output = JSON.stringify(consoleLogSpy.mock.calls);
    expect(output).not.toContain('private');
  });

  it('logs parse failures whose response body contains aborted text', async () => {
    const guardedFetch = createImageDiagnosticFetch(
      vi.fn(
        async () =>
          new Response('aborted', {
            headers: { 'content-type': 'text/plain' },
            status: 502,
          }),
      ) as typeof fetch,
    );

    const response = await runWithImageDebugContext(
      { diagnosticId: 'ig_1234567890abcdef' },
      () => guardedFetch('https://internal.example.com/trpc/async'),
    );

    await expect(response.json()).rejects.toThrow();
    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorClass: 'SyntaxError',
          failurePhase: 'response_parse',
          outcome: 'failed',
          phase: 'dispatch_http_parse',
          response: expect.objectContaining({
            bodyKind: 'text/plain',
            httpStatus: 502,
          }),
        }),
      ]),
    );
  });

  it('logs response body stream read failures without logging the error message', async () => {
    const privateReadError = Object.assign(
      new TypeError('terminated while reading private image response bytes'),
      {
        code: 'ECONNRESET',
      },
    );
    const sourceResponse = new Response('{"result":true}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    vi.spyOn(sourceResponse, 'text').mockRejectedValue(privateReadError);
    const guardedFetch = createImageDiagnosticFetch(
      vi.fn(async () => sourceResponse) as unknown as typeof fetch,
    );

    const response = await runWithImageDebugContext(
      { diagnosticId: 'ig_1234567890abcdef' },
      () => guardedFetch('https://internal.example.com/trpc/async'),
    );

    await expect(response.json()).rejects.toBe(privateReadError);
    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.objectContaining({
            hash: expect.stringMatching(/^[\da-f]{32}$/),
            length: 'ECONNRESET'.length,
            type: 'string',
          }),
          errorClass: 'TypeError',
          failurePhase: 'response_read',
          outcome: 'failed',
          phase: 'dispatch_http_parse',
          response: expect.objectContaining({
            httpStatus: 200,
            mediaType: 'application/json',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('private image response bytes');
  });

  it('does not log response body read failures caused by an intentional abort', async () => {
    const abortController = new AbortController();
    const abortError = new DOMException('AbortError', 'AbortError');
    const sourceResponse = new Response('{"result":true}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    vi.spyOn(sourceResponse, 'text').mockImplementation(async () => {
      abortController.abort();
      throw abortError;
    });
    const guardedFetch = createImageDiagnosticFetch(
      vi.fn(async () => sourceResponse) as unknown as typeof fetch,
    );

    const response = await runWithImageDebugContext(
      { diagnosticId: 'ig_1234567890abcdef' },
      () =>
        guardedFetch('https://internal.example.com/trpc/async', {
          signal: abortController.signal,
        }),
    );

    await expect(response.json()).rejects.toBe(abortError);
    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(
      records.some(
        (record) =>
          record.failurePhase === 'response_read' && record.phase === 'dispatch_http_parse',
      ),
    ).toBe(false);
  });
});
