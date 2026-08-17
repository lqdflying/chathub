/** @vitest-environment node */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { runScript } = require('./startServer.js') as {
  runScript: (
    path: string,
    useProxy?: boolean,
    options?: {
      forwardSignals?: boolean;
      parentProcess?: EventEmitter;
      spawnImpl?: ReturnType<typeof vi.fn>;
    },
  ) => Promise<void>;
};

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  });
}

describe('server launcher signal forwarding', () => {
  it('forwards SIGTERM and propagates the child signal exit code', async () => {
    const child = new FakeChild();
    const parent = new EventEmitter();
    const spawnImpl = vi.fn(() => child);
    const result = runScript('/app/server.js', false, {
      forwardSignals: true,
      parentProcess: parent,
      spawnImpl,
    });

    parent.emit('SIGTERM');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(result).rejects.toMatchObject({ exitCode: 143 });
    expect(parent.listenerCount('SIGINT')).toBe(0);
    expect(parent.listenerCount('SIGTERM')).toBe(0);
  });

  it('propagates a non-zero child exit code', async () => {
    const child = new FakeChild();
    const parent = new EventEmitter();
    const result = runScript('/app/server.js', false, {
      forwardSignals: true,
      parentProcess: parent,
      spawnImpl: vi.fn(() => child),
    });

    child.exitCode = 7;
    child.emit('close', 7, null);

    await expect(result).rejects.toMatchObject({ exitCode: 7 });
  });
});
