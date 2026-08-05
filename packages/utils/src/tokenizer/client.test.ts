import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeWorkerEventType = 'error' | 'message' | 'messageerror';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static postMessageImplementation: ((worker: FakeWorker, message: unknown) => void) | undefined;

  private listeners = new Map<FakeWorkerEventType, Set<EventListenerOrEventListenerObject>>();

  postMessage = vi.fn((message: unknown) => {
    FakeWorker.postMessageImplementation?.(this, message);
  });

  terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: FakeWorkerEventType, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: FakeWorkerEventType, event: Event) {
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
  }

  removeEventListener(type: FakeWorkerEventType, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }
}

const loadClient = async () => await import('./client');

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  FakeWorker.instances = [];
  FakeWorker.postMessageImplementation = undefined;
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('clientEncodeAsync', () => {
  it('uses an opaque request ID and resolves a valid worker response', async () => {
    const { clientEncodeAsync } = await loadClient();
    const prompt = 'private prompt text';
    const promise = clientEncodeAsync(prompt);
    const activeWorker = FakeWorker.instances[0];
    const request = activeWorker.postMessage.mock.calls[0][0] as { id: string; str: string };

    expect(request.str).toBe(prompt);
    expect(request.id).not.toBe(prompt);
    expect(request.id).toMatch(/^tokenizer_[\da-z]+_[\da-z]+$/);

    activeWorker.emit('message', { data: { id: request.id, result: 11 } } as MessageEvent);

    await expect(promise).resolves.toBe(11);
  });

  it('rejects all pending requests and recreates the worker after a worker error', async () => {
    const { clientEncodeAsync } = await loadClient();
    const first = clientEncodeAsync('first').catch((error) => error as Error);
    const second = clientEncodeAsync('second').catch((error) => error as Error);
    const failedWorker = FakeWorker.instances[0];

    failedWorker.emit('error', { error: new Error('worker exploded') } as ErrorEvent);

    expect((await first).message).toBe('worker exploded');
    expect((await second).message).toBe('worker exploded');
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = clientEncodeAsync('retry');
    const replacementWorker = FakeWorker.instances[1];
    const request = replacementWorker.postMessage.mock.calls[0][0] as { id: string };
    replacementWorker.emit('message', { data: { id: request.id, result: 3 } } as MessageEvent);

    await expect(retry).resolves.toBe(3);
  });

  it('rejects pending work when a worker response cannot be decoded', async () => {
    const { clientEncodeAsync } = await loadClient();
    const result = clientEncodeAsync('prompt').catch((error) => error as Error);
    const activeWorker = FakeWorker.instances[0];

    activeWorker.emit('messageerror', new MessageEvent('messageerror'));

    expect((await result).message).toBe('Tokenizer worker response could not be decoded');
    expect(activeWorker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects and resets the worker when postMessage throws synchronously', async () => {
    FakeWorker.postMessageImplementation = () => {
      throw new Error('postMessage failed');
    };
    const { clientEncodeAsync } = await loadClient();

    await expect(clientEncodeAsync('prompt')).rejects.toThrow('postMessage failed');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('times out pending work, cleans up the worker, and permits a retry', async () => {
    vi.useFakeTimers();
    const { clientEncodeAsync } = await loadClient();
    const timedOut = clientEncodeAsync('prompt').catch((error) => error as Error);
    const failedWorker = FakeWorker.instances[0];

    await vi.advanceTimersByTimeAsync(3000);

    expect((await timedOut).message).toBe('Tokenizer worker timed out');
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const retry = clientEncodeAsync('retry');
    const replacementWorker = FakeWorker.instances[1];
    const request = replacementWorker.postMessage.mock.calls[0][0] as { id: string };
    replacementWorker.emit('message', { data: { id: request.id, result: 2 } } as MessageEvent);

    await expect(retry).resolves.toBe(2);
  });
});
