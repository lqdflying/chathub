import * as Comlink from 'comlink';

import type { PythonWorkerType } from './worker';

export interface PythonWorkerHandle {
  /** the Comlink-wrapped worker class — construct with `new handle.RemoteInterpreter(options)` */
  RemoteInterpreter: Comlink.Remote<PythonWorkerType>;
  /** the raw worker, so the owner can terminate a hung run and recreate it */
  worker: Worker;
}

/**
 * Create a fresh Python worker and its Comlink proxy. The service owns the
 * lifecycle: it serializes runs onto a single worker (so concurrent runs can't
 * race the shared Pyodide global) and terminates + recreates it when a run times
 * out, so a runaway `while True` can't poison later runs. Returns undefined
 * outside the browser (there is no worker to run in).
 */
export const createPythonWorker = (): PythonWorkerHandle | undefined => {
  if (typeof Worker === 'undefined') return undefined;
  const worker = new Worker(new URL('worker.ts', import.meta.url), { type: 'module' });
  return { RemoteInterpreter: Comlink.wrap<PythonWorkerType>(worker), worker };
};
