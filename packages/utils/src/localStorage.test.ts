import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncLocalStorage } from './localStorage';

describe('AsyncLocalStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('resolves updateLocalStorage with the merged state when persistence is denied', async () => {
    const storage = new AsyncLocalStorage<{ a?: number }>('LOBE_SYSTEM_STATUS');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await expect(storage.updateLocalStorage(() => ({ a: 1 }))).resolves.toMatchObject({ a: 1 });
    expect(setItem).toHaveBeenCalled();
  });

  it('reports updated:false from updateLocalStorageAtomically when persistence is denied', async () => {
    let lockQueue = Promise.resolve<unknown>(undefined);
    vi.stubGlobal('navigator', {
      locks: {
        request: <Result,>(_name: string, operation: () => Promise<Result>) => {
          const lockRequest = lockQueue.catch(() => undefined).then(operation);
          lockQueue = lockRequest;
          return lockRequest;
        },
      },
    });
    const storage = new AsyncLocalStorage<{ a?: number }>('LOBE_SYSTEM_STATUS');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await expect(storage.updateLocalStorageAtomically(() => ({ a: 1 }))).resolves.toEqual({
      state: expect.objectContaining({ a: 1 }),
      updated: false,
    });
    expect(setItem).toHaveBeenCalled();
  });
});
