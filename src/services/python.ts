import { PythonInterpreter } from '@lobechat/python-interpreter';
import { CodeInterpreterResponse } from '@lobechat/types';

import { pythonEnv } from '@/envs/python';

// Recover the UI if execution hangs (e.g. `while True: pass`, or a slow/blocked
// Pyodide/CDN load). The worker itself keeps running until it's terminated
// (handled at the store layer); this timeout surfaces a clear error instead of
// an infinite spinner.
const EXECUTION_TIMEOUT = 60_000;

class PythonService {
  async runPython(
    code: string,
    packages: string[],
    files: File[],
  ): Promise<CodeInterpreterResponse | undefined> {
    if (typeof Worker === 'undefined') return;

    const run = async (): Promise<CodeInterpreterResponse> => {
      const interpreter = await new PythonInterpreter!({
        pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
        pypiIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
      });
      await interpreter.init();
      await interpreter.installPackages(packages.filter((p) => p !== ''));
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Python execution timed out after ${EXECUTION_TIMEOUT / 1000}s.`)),
        EXECUTION_TIMEOUT,
      );
    });

    try {
      return await Promise.race([run(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const pythonService = new PythonService();
