import { describe, expect, it } from 'vitest';

import { extractKeyFromAppFileProxyUrl } from './fileReference';

describe('extractKeyFromAppFileProxyUrl', () => {
  it('extracts and decodes nested keys from app-proxy URLs', () => {
    const reference =
      'https://chat.example.com/webapi/files/references/nested%20folder/image.png?version=1';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBe(
      'references/nested folder/image.png',
    );
  });

  it('extracts keys from relative app-proxy URLs', () => {
    const reference = '/webapi/files/references/image.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBe(
      'references/image.png',
    );
  });

  it('extracts keys from legacy bare app-proxy paths', () => {
    const reference = 'webapi/files/references/image.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBe(
      'references/image.png',
    );
  });

  it('returns undefined for direct storage URLs', () => {
    const reference = 'https://storage.example.com/references/image.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('returns undefined for storage URLs that collide with the proxy path', () => {
    const reference = 'https://storage.example.com/webapi/files/references/image.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('returns undefined for protocol-relative URLs on a different origin', () => {
    const reference = '//storage.example.com/webapi/files/references/image.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('returns undefined for malformed encoded keys', () => {
    const reference = 'https://chat.example.com/webapi/files/references/%A0.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });
});
