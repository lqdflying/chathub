import { afterEach, describe, expect, it } from 'vitest';

import { summarizeToolsDebugResponse } from './toolsResponseDebug';

const previousDebug = process.env.CHATHUB_TOOLS_DEBUG;

afterEach(() => {
  if (previousDebug === undefined) delete process.env.CHATHUB_TOOLS_DEBUG;
  else process.env.CHATHUB_TOOLS_DEBUG = previousDebug;
});

describe('summarizeToolsDebugResponse', () => {
  it('fingerprints a JSON response without retaining its body', async () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    const summary = await summarizeToolsDebugResponse(
      new Response('{"private":"tool result"}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );

    expect(summary).toMatchObject({
      bodyKind: 'json',
      fingerprintBytes: 25,
      fingerprintTruncated: false,
      httpStatus: 200,
      mediaType: 'application/json',
    });
    expect(summary.responseFingerprint).toMatch(/^[\da-f]{16}$/);
    expect(JSON.stringify(summary)).not.toContain('tool result');
  });

  it('identifies an HTML response from its bounded prefix', async () => {
    process.env.CHATHUB_TOOLS_DEBUG = '1';
    const summary = await summarizeToolsDebugResponse(
      new Response('<!DOCTYPE html><html><body>private proxy page</body></html>', {
        headers: { 'content-type': 'text/html' },
        status: 502,
      }),
    );

    expect(summary).toMatchObject({ bodyKind: 'html', httpStatus: 502, mediaType: 'text/html' });
    expect(JSON.stringify(summary)).not.toContain('private proxy page');
  });
});
