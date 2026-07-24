// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_IMAGE_DIAGNOSTIC_HEADER } from '@/const/tools';

import { getTrustedImageDiagnosticId } from './context';

const diagnosticId = 'ig_1234567890abcdef';
const internalSecret = 'test-internal-secret';

vi.mock('@/config/db', () => ({
  serverDBEnv: { KEY_VAULTS_SECRET: 'test-internal-secret' },
}));

const createRequest = (headers: Record<string, string>) =>
  new NextRequest('https://chathub.example.com/trpc/async/image.createImage', { headers });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getTrustedImageDiagnosticId', () => {
  it.each([
    ['missing bearer', undefined],
    ['wrong bearer', 'Bearer wrong-secret'],
    ['malformed bearer', `Bearer ${internalSecret} unexpected`],
  ])('ignores a valid-looking diagnostic id with %s', (_, authorization) => {
    const headers: Record<string, string> = {
      [CHATHUB_IMAGE_DIAGNOSTIC_HEADER]: diagnosticId,
    };
    if (authorization) headers.Authorization = authorization;

    expect(getTrustedImageDiagnosticId(createRequest(headers))).toBeUndefined();
  });

  it('ignores a malformed diagnostic id from an authenticated internal request', () => {
    const request = createRequest({
      Authorization: `Bearer ${internalSecret}`,
      [CHATHUB_IMAGE_DIAGNOSTIC_HEADER]: 'attacker-controlled-value',
    });

    expect(getTrustedImageDiagnosticId(request)).toBeUndefined();
  });

  it('accepts a normalized diagnostic id from an authenticated internal request', () => {
    const request = createRequest({
      Authorization: `Bearer ${internalSecret}`,
      [CHATHUB_IMAGE_DIAGNOSTIC_HEADER]: diagnosticId,
    });

    expect(getTrustedImageDiagnosticId(request)).toBe(diagnosticId);
  });
});
