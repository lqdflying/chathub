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

    // migrate old data
    if (localStorage.getItem(PREV_KEY)) {
      const data = JSON.parse(localStorage.getItem(PREV_KEY) || '{}');

      const preference = data.state.preference;

      if (data.state?.preference) {
        localStorage.setItem('LOBE_PREFERENCE', JSON.stringify(preference));
      }
      localStorage.removeItem(PREV_KEY);
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
    await this.updateLocalStorage(() => state);
  }

  async getFromLocalStorage(key: StorageKey = this.storageKey): Promise<State> {
    return JSON.parse(localStorage.getItem(key) || '{}');
  }

  async updateLocalStorage(
    update: (currentState: State) => object | undefined | Promise<object | undefined>,
  ): Promise<State> {
    return this.runExclusive(async () => {
      const currentState = await this.getFromLocalStorage();
      const stateUpdate = await update(currentState);
      if (!stateUpdate) return currentState;

      const nextState = { ...currentState, ...stateUpdate };
      localStorage.setItem(this.storageKey, JSON.stringify(nextState));
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
      localStorage.setItem(this.storageKey, JSON.stringify(nextState));
      return { state: nextState, updated: true };
    });
  }
}
