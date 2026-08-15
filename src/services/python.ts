import { PythonWorkerHandle, createPythonWorker } from '@lobechat/python-interpreter';
import { CodeInterpreterResponse } from '@lobechat/types';

import { pythonEnv } from '@/envs/python';

// Recover the UI if execution hangs (e.g. `while True: pass`, or a slow/blocked
// Pyodide/CDN load): time the run out and terminate the worker so the next run
// starts fresh.
const EXECUTION_TIMEOUT = 60_000;

class PythonService {
  private handle: PythonWorkerHandle | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  async runPython(
    code: string,
    packages: string[],
    files: File[],
  ): Promise<CodeInterpreterResponse | undefined> {
    if (typeof Worker === 'undefined') return;

    // Serialize runs onto one worker so concurrent tool calls can't race the
    // shared Pyodide global; keep the chain alive even if a run rejects.
    const task = this.queue.then(() => this.runOnce(code, packages, files));
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  private getHandle(): PythonWorkerHandle | undefined {
    if (!this.handle) this.handle = createPythonWorker();
    return this.handle;
  }

  private terminate() {
    this.handle?.worker.terminate();
    this.handle = undefined;
  }

  private async runOnce(
    code: string,
    packages: string[],
    files: File[],
  ): Promise<CodeInterpreterResponse | undefined> {
    const handle = this.getHandle();
    if (!handle) return;

    const run = async (): Promise<CodeInterpreterResponse> => {
      const interpreter = await new handle.RemoteInterpreter({
        pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
        pypiIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
      });
      await interpreter.init();
      // bundled-first package preparation: Pyodide-distribution packages load
      // before micropip ever resolves anything from PyPI
      await interpreter.prepareEnvironment(code, packages);
      await interpreter.uploadFiles(files);

      const result = await interpreter.runPython(code);

      const resultFiles = await interpreter.downloadFiles();
      return {
        files: resultFiles.map((file: any) => ({
          data: file,
          filename: file.name,
          previewUrl: URL.createObjectURL(file),
        })),
        ...result,
      };
    };

    const runPromise = run();
    // if the worker is terminated after a timeout, the pending call can reject
    // late — swallow it so it never surfaces as an unhandled rejection
    runPromise.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Python execution timed out after ${EXECUTION_TIMEOUT / 1000}s.`)),
        EXECUTION_TIMEOUT,
      );
    });

    try {
      return await Promise.race([runPromise, timeout]);
    } catch (error) {
      // kill the (possibly hung) worker so the next run starts from a clean state
      this.terminate();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const pythonService = new PythonService();
