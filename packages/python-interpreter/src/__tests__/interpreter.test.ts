// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('createPythonWorker', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined outside the browser', async () => {
    const { createPythonWorker } = await import('../index');
    expect(createPythonWorker()).toBeUndefined();
  });

  it('creates a worker + Comlink proxy in the browser', async () => {
    const MockWorker = vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    }));
    vi.stubGlobal('Worker', MockWorker);

    const { createPythonWorker } = await import('../index');
    const handle = createPythonWorker();

    expect(handle).toBeDefined();
    expect(handle?.worker).toBeDefined();
    expect(handle?.RemoteInterpreter).toBeDefined();
  });
});
