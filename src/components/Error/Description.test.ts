import { describe, expect, it } from 'vitest';

import { getFetchErrorResponseKey } from './Description';

describe('getFetchErrorResponseKey', () => {
  it('uses a generic request error when the HTTP status is unavailable', () => {
    expect(getFetchErrorResponseKey()).toBe('response.UnknownChatFetchError');
  });

  it('uses the status-specific translation when available', () => {
    expect(getFetchErrorResponseKey(502)).toBe('response.502');
  });
});
