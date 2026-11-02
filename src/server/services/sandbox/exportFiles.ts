import { distinctOutputFilenames, outputRelativeName } from './outputNames';
import { type SandboxFile, SandboxRequestError, type SandboxWorkspace } from './types';

export interface SandboxFileToLoad {
  /** How a skip reason names the file (the path as the model wrote it). */
  label: string;
  /** Absolute path in the sandbox. */
  resolved: string;
}

/**
 * Reads files for the chat and names them as `exportFile` does. Empty files
 * and paths the sandbox rejects (missing, too large) are skipped with a
 * reason instead of failing the whole call.
 */
export const loadSandboxFiles = async (
  workspace: SandboxWorkspace,
  items: SandboxFileToLoad[],
  maxFileBytes: number,
): Promise<{ files: SandboxFile[]; skipped: string[] }> => {
  const loaded: Array<{ content: Uint8Array; relative: string }> = [];
  const skipped: string[] = [];
  for (const { label, resolved } of items) {
    try {
      const content = await workspace.readFile(resolved, maxFileBytes);
      if (content.byteLength === 0) {
        skipped.push(`${label}: the file is empty`);
        continue;
      }
      loaded.push({ content, relative: outputRelativeName(workspace.workdir, resolved) });
    } catch (error) {
      if (!(error instanceof SandboxRequestError)) throw error;
      skipped.push(`${label}: ${error.message}`);
    }
  }
  const filenames = distinctOutputFilenames(loaded.map((item) => item.relative));
  return {
    files: loaded.map((item, index) => ({ content: item.content, filename: filenames[index] })),
    skipped,
  };
};
