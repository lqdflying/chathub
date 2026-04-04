import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAuthRedirect } from './normalizeAuthRedirect';

describe('normalizeAuthRedirect', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost:33210/chat'),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it('should keep true same-origin redirects as in-app paths', () => {
    expect(normalizeAuthRedirect('http://localhost:33210/chat?tab=1#top', '/')).toBe(
      '/chat?tab=1#top',
    );
  });

  it('should normalize local absolute redirects returned from another local host', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost:33210/chat'),
    });

    expect(normalizeAuthRedirect('http://0.0.0.0:33210/next-auth/signin', '/')).toBe(
      '/next-auth/signin',
    );
  });

  it('should fallback for external absolute redirects', () => {
    expect(normalizeAuthRedirect('https://evil.com/phish', '/')).toBe('/');
  });

  it('should fallback for malformed urls', () => {
    expect(normalizeAuthRedirect('http://%', '/next-auth/signin')).toBe('/next-auth/signin');
  });
});