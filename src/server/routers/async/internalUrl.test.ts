import { describe, expect, it } from 'vitest';

import { resolveAsyncServerBaseUrl } from './internalUrl';

describe('resolveAsyncServerBaseUrl', () => {
  it('uses explicit INTERNAL_APP_URL first and normalizes trailing slashes', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        internalAppUrl: ' http://internal:3210/// ',
        localRewriteEnabled: true,
        port: '3210',
      }),
    ).toEqual({
      source: 'internal_app_url',
      url: 'http://internal:3210',
    });
  });

  it('uses Docker local loopback when local rewriting is enabled outside Vercel', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        isVercel: false,
        localRewriteEnabled: true,
        port: '4010',
      }),
    ).toEqual({
      source: 'local_loopback',
      url: 'http://127.0.0.1:4010',
      warning: undefined,
    });
  });

  it('uses the default Docker port when the port is empty', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        isVercel: false,
        localRewriteEnabled: true,
        port: '',
      }).url,
    ).toBe('http://127.0.0.1:3210');
  });

  it('falls back to APP_URL on Vercel and normalizes trailing slashes', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com///',
        isVercel: true,
        localRewriteEnabled: true,
        port: '3210',
      }),
    ).toEqual({
      source: 'app_url',
      url: 'https://public.example.com',
      warning: undefined,
    });
  });

  it('falls back to APP_URL when local rewriting is disabled', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        isVercel: false,
        localRewriteEnabled: false,
        port: '3210',
      }).source,
    ).toBe('app_url');
  });

  it('falls back with a warning for invalid INTERNAL_APP_URL', () => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        internalAppUrl: 'ftp://private.example.com',
        isVercel: false,
        localRewriteEnabled: false,
      }),
    ).toEqual({
      source: 'app_url',
      url: 'https://public.example.com',
      warning: 'invalid_internal_app_url',
    });
  });

  it.each([
    'http://user:password@internal:3210',
    'http://internal:3210?tenant=private',
    'http://internal:3210#private-fragment',
    'http://internal:3210/base-path',
  ])('rejects INTERNAL_APP_URL values that are not clean origins: %s', (internalAppUrl) => {
    expect(
      resolveAsyncServerBaseUrl({
        appUrl: 'https://public.example.com',
        internalAppUrl,
        isVercel: false,
        localRewriteEnabled: false,
      }),
    ).toEqual({
      source: 'app_url',
      url: 'https://public.example.com',
      warning: 'invalid_internal_app_url',
    });
  });
});
