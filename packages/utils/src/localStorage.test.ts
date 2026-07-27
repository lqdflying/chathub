import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncLocalStorage } from './localStorage';

describe('AsyncLocalStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('constructs when browser storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => new AsyncLocalStorage('LOBE_SYSTEM_STATUS')).not.toThrow();
  });

  it('constructs and preserves malformed legacy data', () => {
    localStorage.setItem('LOBE_GLOBAL', '{malformed');

    expect(() => new AsyncLocalStorage('LOBE_SYSTEM_STATUS')).not.toThrow();
    expect(localStorage.getItem('LOBE_GLOBAL')).toBe('{malformed');
    expect(localStorage.getItem('LOBE_PREFERENCE')).toBeNull();
  });

  it('migrates valid legacy preferences', () => {
    const preference = {
      imageConfig: {
        model: 'gpt-image-2',
        provider: 'openaicompatible',
      },
    };
    localStorage.setItem('LOBE_GLOBAL', JSON.stringify({ state: { preference } }));

    new AsyncLocalStorage('LOBE_SYSTEM_STATUS');

    expect(JSON.parse(localStorage.getItem('LOBE_PREFERENCE') || '{}')).toEqual(preference);
    expect(localStorage.getItem('LOBE_GLOBAL')).toBeNull();
  });
});
