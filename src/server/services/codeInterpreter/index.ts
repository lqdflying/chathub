import type { LobeChatDatabase } from '@lobechat/database';
import type { CodeInterpreterResponse } from '@lobechat/types';

import { gatherConversationSandboxFiles, persistSandboxOutputFiles } from './files';
import { CodeInterpreterSandboxService } from './sandbox';
import { CodeInterpreterSandboxError } from './types';

export { CodeInterpreterSandboxService, isCodeInterpreterSandboxConfigured } from './sandbox';
export { CodeInterpreterSandboxError, type CodeInterpreterSandboxOutcome } from './types';

const MAX_ERROR_CHARS = 100_000;

export interface RunCodeInterpreterParams {
  code: string;
  db: LobeChatDatabase;
  groupId?: string | null;
  operationHash?: string;
  packages?: string[];
  sessionId?: string | null;
  topicId?: string | null;
  userId: string;
}

const toOutput = (stdout: string, stderr: string): CodeInterpreterResponse['output'] => {
  const output: NonNullable<CodeInterpreterResponse['output']> = [];
  if (stdout) output.push({ data: stdout, type: 'stdout' });
  if (stderr) output.push({ data: stderr, type: 'stderr' });
  return output.length > 0 ? output : undefined;
};

const failedResponse = (message: string): CodeInterpreterResponse => ({
  output: [
    {
      data:
        message.length > MAX_ERROR_CHARS
          ? `${message.slice(0, MAX_ERROR_CHARS)}\n…[error truncated]`
          : message,
      type: 'stderr',
    },
  ],
  success: false,
});

export const runCodeInterpreter = async ({
  code,
  db,
  groupId,
  operationHash,
  packages = [],
  sessionId,
  topicId,
  userId,
}: RunCodeInterpreterParams): Promise<CodeInterpreterResponse> => {
  if (!code.trim()) return failedResponse('Code Interpreter received empty code.');

  const packageCount = packages.map((item) => item.trim()).filter(Boolean).length;
  const files = await gatherConversationSandboxFiles({
    db,
    groupId,
    sessionId,
    topicId,
    userId,
  });

  try {
    const result = await new CodeInterpreterSandboxService().run({
      code,
      files,
      operationHash,
      packageCount,
    });
    const persisted = await persistSandboxOutputFiles({ db, files: result.files, userId });
    return {
      files: persisted.length > 0 ? persisted : undefined,
      output: toOutput(result.stdout, result.stderr),
      success: result.success,
    };
  } catch (error) {
    if (error instanceof CodeInterpreterSandboxError) {
      return failedResponse(error.message);
    }
    return failedResponse(
      error instanceof Error ? error.message : 'Code Interpreter sandbox failed.',
    );
  }
};
