import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPythonWorker } = vi.hoisted(() => ({ createPythonWorker: vi.fn() }));

vi.mock('@lobechat/python-interpreter', () => ({ createPythonWorker }));
vi.mock('@/envs/python', () => ({ pythonEnv: {} }));

const makeHandle = () => {
  const interpreter = {
    downloadFiles: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
    prepareEnvironment: vi.fn().mockResolvedValue(undefined),
    runPython: vi.fn().mockResolvedValue({ output: [], success: true }),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
  };
  const handle = {
    RemoteInterpreter: class {
      constructor() {
        // Comlink-style: constructing yields (a promise of) the remote instance
        return interpreter as any;
      }
    },
    worker: { terminate: vi.fn() },
  };
  return { handle, interpreter };
};

describe('pythonService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('Worker', class {});
  });

  it('passes code and packages to prepareEnvironment (bundled-first contract)', async () => {
    const { handle, interpreter } = makeHandle();
    createPythonWorker.mockReturnValue(handle);
    const { pythonService } = await import('./python');

    await pythonService.runPython('import jsonschema', ['python-docx'], []);

    expect(interpreter.prepareEnvironment).toHaveBeenCalledWith('import jsonschema', [
      'python-docx',
    ]);
  });

  it('terminates the worker on a failed install and the next run gets a fresh one', async () => {
    const failing = makeHandle();
    failing.interpreter.prepareEnvironment.mockRejectedValue(
      new Error('No Pyodide/WebAssembly-compatible build exists for: jsonschema>=4.26'),
    );
    const healthy = makeHandle();
    createPythonWorker.mockReturnValueOnce(failing.handle).mockReturnValueOnce(healthy.handle);
    const { pythonService } = await import('./python');

    await expect(pythonService.runPython('print(1)', ['jsonschema>=4.26'], [])).rejects.toThrow(
      'No Pyodide/WebAssembly-compatible build',
    );
    // the broken worker is discarded…
    expect(failing.handle.worker.terminate).toHaveBeenCalledTimes(1);

    // …and the next run constructs a fresh one and succeeds (no wedged state)
    const result = await pythonService.runPython('print(2)', [], []);
    expect(createPythonWorker).toHaveBeenCalledTimes(2);
    expect(result?.success).toBe(true);
  });
});
