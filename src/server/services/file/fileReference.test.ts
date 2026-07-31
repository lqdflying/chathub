import { describe, expect, it } from 'vitest';

import {
  extractKeyFromAppFileProxyUrl,
  isPrivilegedStorageKey,
  isValidFileProxyKeySegments,
  isValidUploadPathname,
} from './fileReference';

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

  it('rejects encoded-slash traversal smuggled inside a single segment', () => {
    const reference = 'https://chat.example.com/webapi/files/a/..%2f..%2fother-user/secret.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('rejects an encoded ../ prefix', () => {
    const reference = 'https://chat.example.com/webapi/files/%2e%2e%2fsecret.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('rejects a whole segment that decodes to ..', () => {
    const reference = 'https://chat.example.com/webapi/files/%2e%2e/secret.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('rejects an encoded backslash in a segment', () => {
    const reference = 'https://chat.example.com/webapi/files/refs/a%5Cb.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('rejects a NUL byte in a segment', () => {
    const reference = 'https://chat.example.com/webapi/files/refs/a%00.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });

  it('returns undefined for a literal ../ that URL-normalizes off the proxy prefix', () => {
    const reference = 'https://chat.example.com/webapi/files/../secret.png';

    expect(extractKeyFromAppFileProxyUrl(reference, 'https://chat.example.com')).toBeUndefined();
  });
});

describe('isValidFileProxyKeySegments', () => {
  it('accepts ordinary decoded key segments', () => {
    expect(isValidFileProxyKeySegments(['files', '466737', 'abc.png'])).toBe(true);
  });

  it('rejects dot, empty, separator-smuggling and control-char segments', () => {
    expect(isValidFileProxyKeySegments(['..'])).toBe(false);
    expect(isValidFileProxyKeySegments(['a', '.', 'b.png'])).toBe(false);
    expect(isValidFileProxyKeySegments(['a', '', 'b.png'])).toBe(false);
    expect(isValidFileProxyKeySegments(['a/b', 'c.png'])).toBe(false);
    expect(isValidFileProxyKeySegments(['a\\b', 'c.png'])).toBe(false);
    expect(isValidFileProxyKeySegments(['a\u0000b', 'c.png'])).toBe(false);
  });

  it('rejects an empty segment list', () => {
    expect(isValidFileProxyKeySegments([])).toBe(false);
  });
});

describe('isPrivilegedStorageKey', () => {
  it('flags server-only namespaces and passes ordinary upload keys', () => {
    expect(isPrivilegedStorageKey('generations/images/x.png')).toBe(true);
    expect(isPrivilegedStorageKey('user/avatar/1/x.png')).toBe(true);
    expect(isPrivilegedStorageKey('files/466737/uuid.png')).toBe(false);
    expect(isPrivilegedStorageKey('ragEval/x.csv')).toBe(false);
  });
});

describe('isValidUploadPathname', () => {
  it('accepts an ordinary client upload path', () => {
    expect(isValidUploadPathname('files/2026-07-30/uuid.png')).toBe(true);
    expect(isValidUploadPathname('ragEval/uuid.csv')).toBe(true);
  });

  it('rejects privileged namespaces, traversal, absolute, backslash and control chars', () => {
    expect(isValidUploadPathname('generations/images/x.png')).toBe(false);
    expect(isValidUploadPathname('user/avatar/victim/x.png')).toBe(false);
    expect(isValidUploadPathname('files/../generations/x.png')).toBe(false);
    expect(isValidUploadPathname('/abs/x.png')).toBe(false);
    expect(isValidUploadPathname('files/a\\b.png')).toBe(false);
    expect(isValidUploadPathname(`files/a${String.fromCharCode(1)}b.png`)).toBe(false);
    expect(isValidUploadPathname('')).toBe(false);
    expect(isValidUploadPathname(`files/${'a'.repeat(1024)}.png`)).toBe(false);
  });
});
