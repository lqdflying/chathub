const PREV_KEY = 'LOBE_GLOBAL';

// LOBE_PREFERENCE for userStore
// LOBE_GLOBAL_PREFERENCE for globalStore
type StorageKey = 'LOBE_PREFERENCE' | 'LOBE_SYSTEM_STATUS';

const storageUpdateQueues = new Map<StorageKey, Promise<unknown>>();

export interface AtomicLocalStorageUpdateResult<State> {
  state: State;
  updated: boolean;
}

export class AsyncLocalStorage<State> {
  private storageKey: StorageKey;

  constructor(storageKey: StorageKey) {
    this.storageKey = storageKey;

    // skip server side rendering
    if (typeof window === 'undefined') return;

    this.migrateLegacyPreference();
  }

  private migrateLegacyPreference() {
    try {
      const legacyState = localStorage.getItem(PREV_KEY);
      if (!legacyState) return;

      const data = JSON.parse(legacyState);
      const preference = data.state?.preference;

      if (preference) {
        localStorage.setItem('LOBE_PREFERENCE', JSON.stringify(preference));
      }
      localStorage.removeItem(PREV_KEY);
    } catch {
      // Browser storage can be unavailable, and malformed legacy data should not block startup.
    }
  }

  private async runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(`lobechat:${this.storageKey}`, operation);
    }

    const previousUpdate = storageUpdateQueues.get(this.storageKey) || Promise.resolve();
    const currentUpdate = previousUpdate.catch(() => undefined).then(operation);
    storageUpdateQueues.set(this.storageKey, currentUpdate);

    try {
      return await currentUpdate;
    } finally {
      if (storageUpdateQueues.get(this.storageKey) === currentUpdate) {
        storageUpdateQueues.delete(this.storageKey);
      }
    }
  }

  async saveToLocalStorage(state: object) {
    try {
      await this.updateLocalStorage(() => state);
    } catch {
      // Storage may be denied or full — ignore write failures silently.
    }
  }

  async getFromLocalStorage(key: StorageKey = this.storageKey): Promise<State> {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {} as State;
    }
  }

  async updateLocalStorage(
    update: (currentState: State) => object | undefined | Promise<object | undefined>,
  ): Promise<State> {
    return this.runExclusive(async () => {
      const currentState = await this.getFromLocalStorage();
      const stateUpdate = await update(currentState);
      if (!stateUpdate) return currentState;

      const nextState = { ...currentState, ...stateUpdate };
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(nextState));
      } catch {
        // Storage may be denied or full — keep the in-memory result, drop the persist.
      }
      return nextState;
    });
  }

  async updateLocalStorageAtomically(
    update: (currentState: State) => object | undefined | Promise<object | undefined>,
  ): Promise<AtomicLocalStorageUpdateResult<State>> {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      return { state: await this.getFromLocalStorage(), updated: false };
    }

    return navigator.locks.request(`lobechat:${this.storageKey}`, async () => {
      const currentState = await this.getFromLocalStorage();
      const stateUpdate = await update(currentState);
      if (!stateUpdate) return { state: currentState, updated: false };

      const nextState = { ...currentState, ...stateUpdate };
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(nextState));
      } catch {
        // Persist failed: report not-updated so no caller ever treats an unpersisted
        // migration as durable; the in-memory result is still returned.
        return { state: nextState, updated: false };
      }
      return { state: nextState, updated: true };
    });
  }
}
