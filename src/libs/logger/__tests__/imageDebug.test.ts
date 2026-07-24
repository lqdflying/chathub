import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeImageDebugError,
  fingerprintImageDebugValue,
  logImageDebugSafe,
  logImageDebugVerbose,
  runWithImageDebugContext,
} from '../imageDebug';

describe('structured image debug logging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalImageDebug: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalImageDebug = process.env.CHATHUB_IMAGE_DEBUG;
    originalKey = process.env.KEY_VAULTS_SECRET;
    delete process.env.CHATHUB_IMAGE_DEBUG;
    process.env.KEY_VAULTS_SECRET = 'test-image-debug-secret';
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalImageDebug === undefined) delete process.env.CHATHUB_IMAGE_DEBUG;
    else process.env.CHATHUB_IMAGE_DEBUG = originalImageDebug;
    if (originalKey === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = originalKey;
    vi.restoreAllMocks();
  });

  it('emits safe events as prefixed JSON', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';

    logImageDebugSafe('submission_accepted', {
      imageCount: 2,
      outcome: 'accepted',
      phase: 'submission',
      provider: 'openai',
    });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-image-debug:submission_accepted]');
    expect(JSON.parse(json)).toMatchObject({
      debugLevel: 'safe',
      imageCount: 2,
      outcome: 'accepted',
      phase: 'submission',
      provider: {
        hash: expect.stringMatching(/^[\da-f]{32}$/),
        length: 6,
        type: 'string',
      },
      schemaVersion: 1,
    });
    expect(JSON.parse(json).timestamp).toEqual(expect.any(String));
  });

  it('fingerprints arbitrary provider values instead of logging PII', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';

    logImageDebugSafe('submission_accepted', {
      phase: 'submission',
      provider: 'customer@example.com',
    });

    const output = consoleLogSpy.mock.calls[0][1];
    const record = JSON.parse(output);
    expect(output).not.toContain('customer@example.com');
    expect(record.provider).toEqual({
      hash: expect.stringMatching(/^[\da-f]{32}$/),
      length: 20,
      type: 'string',
    });
  });

  it('does not expose arbitrary error class names', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    const privateError = new Error('private upstream failure');
    privateError.name = 'customer@example.com';

    logImageDebugSafe('provider_call_settled', {
      ...describeImageDebugError(privateError),
      phase: 'provider_call',
    });
    logImageDebugSafe('provider_call_settled', {
      errorClass: 'customer@example.com',
      phase: 'provider_call',
    });

    const records = consoleLogSpy.mock.calls.map(([, json]) => JSON.parse(json));
    expect(records[0].errorClass).toBe('OtherError');
    expect(records[1].errorClass).toBe('OtherError');
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('customer@example.com');
  });

  it('does not infer cancellation from arbitrary error message text', () => {
    const metadata = describeImageDebugError(new Error('upstream request aborted unexpectedly'));

    expect(metadata).toMatchObject({
      aborted: false,
      errorClass: 'Error',
    });
  });

  it('correlates records with a diagnostic id and monotonic sequence', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';

    runWithImageDebugContext(
      {
        diagnosticId: 'ig_1234567890abcdef',
        operation: 'image.createImage',
        runtime: 'lambda',
        transport: 'trpc',
      },
      () => {
        logImageDebugSafe('dispatch_started', { phase: 'dispatch' });
        logImageDebugSafe('dispatch_settled', { outcome: 'completed', phase: 'dispatch' });
      },
    );

    const first = JSON.parse(consoleLogSpy.mock.calls[0][1]);
    const second = JSON.parse(consoleLogSpy.mock.calls[1][1]);
    expect(first).toMatchObject({
      diagnosticId: 'ig_1234567890abcdef',
      eventSequence: 1,
      operation: 'image.createImage',
      runtime: 'lambda',
    });
    expect(first.spanId).toMatch(/^is_[\da-f]{16}$/);
    expect(second.eventSequence).toBe(2);
    expect(second.spanId).toBe(first.spanId);
  });

  it('does not emit raw prompts, URLs, IDs, credentials, messages, or stacks', () => {
    process.env.CHATHUB_IMAGE_DEBUG = 'verbose';

    logImageDebugSafe('provider_call_settled', {
      apiKey: 'sk-private',
      errorMessage: 'Unexpected token < private html',
      generationId: 'private-generation-id',
      imageUrl: 'https://private.example.com/image.png?token=secret',
      prompt: 'private prompt',
      stack: 'private stack',
      userId: 'private-user-id',
    });
    logImageDebugVerbose('submission_accepted', {
      params: {
        imageUrls: ['https://private.example.com/reference.png'],
        prompt: 'private prompt',
      },
      provider: 'openai',
    });

    const output = JSON.stringify(consoleLogSpy.mock.calls);
    expect(output).not.toMatch(
      /sk-private|private html|private-generation-id|private\.example\.com|private prompt|private stack|private-user-id|reference\.png/,
    );
    expect(output).toContain('[chathub-image-debug:provider_call_settled]');
    expect(output).toContain('[chathub-image-debug:submission_accepted]');
  });

  it('creates stable bounded fingerprints that retain large-string tail sensitivity', () => {
    const sharedPrefix = 'x'.repeat(1024 * 1024);
    const firstValue = `${sharedPrefix}FIRST_PRIVATE_SUFFIX`;
    const secondValue = `${sharedPrefix}SECOND_PRIVATE_SUFFIX`;

    const firstHash = fingerprintImageDebugValue('large-prompt', firstValue);
    const repeatedHash = fingerprintImageDebugValue('large-prompt', firstValue);
    const secondHash = fingerprintImageDebugValue('large-prompt', secondValue);

    expect(firstHash).toMatch(/^[\da-f]{32}$/);
    expect(repeatedHash).toBe(firstHash);
    expect(secondHash).not.toBe(firstHash);
  });

  it('bounds verbose records for oversized prompts and data URIs', () => {
    process.env.CHATHUB_IMAGE_DEBUG = 'verbose';
    const privatePromptMarker = 'PRIVATE_PROMPT_MARKER';
    const privateImageMarker = 'PRIVATE_IMAGE_MARKER';

    logImageDebugVerbose('submission_accepted', {
      imageUrls: [`data:image/png;base64,${privateImageMarker}${'a'.repeat(1024 * 1024)}`],
      nested: Array.from({ length: 20 }, (_, index) => ({
        prompt: `${privatePromptMarker}-${index}-${'p'.repeat(1024 * 1024)}`,
      })),
      wideObject: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `private-key-${index}`,
          `private-value-${index}`,
        ]),
      ),
    });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [, serializedRecord] = consoleLogSpy.mock.calls[0];
    expect(Buffer.byteLength(serializedRecord, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(serializedRecord).not.toContain(privatePromptMarker);
    expect(serializedRecord).not.toContain(privateImageMarker);
    expect(serializedRecord).not.toContain('data:image/png');
    expect(serializedRecord).not.toContain('private-key');
    expect(serializedRecord).not.toContain('private-value');
    expect(serializedRecord).toContain('"propertiesTruncated":true');
  });
});
