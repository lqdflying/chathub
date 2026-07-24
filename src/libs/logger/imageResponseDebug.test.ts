import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createImageDebugResponseBodySample,
  summarizeImageDebugResponse,
} from './imageResponseDebug';

const previousDebug = process.env.CHATHUB_IMAGE_DEBUG;
const previousKey = process.env.KEY_VAULTS_SECRET;

afterEach(() => {
  if (previousDebug === undefined) delete process.env.CHATHUB_IMAGE_DEBUG;
  else process.env.CHATHUB_IMAGE_DEBUG = previousDebug;
  if (previousKey === undefined) delete process.env.KEY_VAULTS_SECRET;
  else process.env.KEY_VAULTS_SECRET = previousKey;
});

describe('summarizeImageDebugResponse', () => {
  it('fingerprints a caller-supplied JSON sample without consuming the response', async () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-image-debug-secret';

    const bodyText = '{"private":"image result"}';
    const response = new Response('{"private":"image result"}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });

    const summary = summarizeImageDebugResponse(
      response,
      createImageDebugResponseBodySample(bodyText),
    );
    await expect(response.json()).resolves.toEqual({ private: 'image result' });

    expect(summary).toMatchObject({
      bodyKind: 'json',
      fingerprintBytes: 26,
      fingerprintTruncated: false,
      httpStatus: 200,
      mediaType: 'application/json',
    });
    expect(summary.responseFingerprint).toMatch(/^[\da-f]{16}$/);
    expect(JSON.stringify(summary)).not.toContain('image result');
  });

  it('identifies an HTML response from its bounded prefix', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-image-debug-secret';

    const bodyText = '<!DOCTYPE html><html><body>private proxy page</body></html>';
    const summary = summarizeImageDebugResponse(
      new Response('<!DOCTYPE html><html><body>private proxy page</body></html>', {
        headers: { 'content-type': 'text/html' },
        status: 502,
      }),
      createImageDebugResponseBodySample(bodyText),
    );

    expect(summary).toMatchObject({ bodyKind: 'html', httpStatus: 502, mediaType: 'text/html' });
    expect(JSON.stringify(summary)).not.toContain('private proxy page');
  });

  it('classifies valid JSON larger than the sample independently from truncation', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    process.env.KEY_VAULTS_SECRET = 'test-image-debug-secret';

    const bodyText = JSON.stringify({ private: 'x'.repeat(300 * 1024) });
    const summary = summarizeImageDebugResponse(
      new Response(bodyText, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
      createImageDebugResponseBodySample(bodyText),
    );

    expect(summary).toMatchObject({
      bodyKind: 'json',
      fingerprintBytes: 256 * 1024,
      fingerprintTruncated: true,
    });
  });

  it('returns response metadata without reading or cloning its body', () => {
    process.env.CHATHUB_IMAGE_DEBUG = '1';
    const response = new Response('private body', {
      headers: { 'content-type': 'text/plain' },
      status: 202,
    });
    const cloneSpy = vi.spyOn(response, 'clone');

    expect(summarizeImageDebugResponse(response)).toEqual({
      contentEncoding: undefined,
      contentLength: undefined,
      httpStatus: 202,
      mediaType: 'text/plain',
    });
    expect(response.bodyUsed).toBe(false);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
});
