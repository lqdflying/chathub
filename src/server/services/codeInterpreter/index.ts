import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import type { CodeInterpreterResponse } from '@lobechat/types';

import { toPersistedConversationSessionId } from '@/server/services/conversationGeneration/inboxSession';
import { sandboxEnv } from '@/envs/sandbox';
import {
  getSandboxProvider,
  listConversationSandboxInputs,
  persistSandboxOutputFiles,
  SandboxError,
} from '@/server/services/sandbox';

const MAX_ERROR_CHARS = 100_000;

export interface RunCodeInterpreterParams {
  code: string;
  db: LobeChatDatabase;
  groupId?: string | null;
  operationHash?: string;
  packages?: string[];
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
}

/**
 * One sandbox scope per conversation, matching the scope input files are
 * gathered from: a portal thread is its own scope, the main topic another, and
 * an agent's messages outside any topic a third. Hashed so no raw ids reach the
 * sandbox server, where the key becomes a container label.
 */
export const buildSandboxSessionKey = ({
  groupId,
  sessionId,
  threadId,
  topicId,
  userId,
}: Pick<RunCodeInterpreterParams, 'groupId' | 'sessionId' | 'threadId' | 'topicId' | 'userId'>) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        userId,
        groupId || null,
        toPersistedConversationSessionId(sessionId) ?? null,
        topicId || null,
        threadId || null,
      ]),
    )
    .digest('hex')
    .slice(0, 32);

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
  threadId,
  topicId,
  userId,
}: RunCodeInterpreterParams): Promise<CodeInterpreterResponse> => {
  if (!code.trim()) return failedResponse('Code Interpreter received empty code.');

  void packages;
  const inputs = await listConversationSandboxInputs({
    db,
    groupId,
    sessionId,
    threadId,
    topicId,
    userId,
  });
  const timeoutMs = sandboxEnv.SANDBOX_TIMEOUT;

  try {
    return await getSandboxProvider().withWorkspace(
      {
        apiName: 'runPython',
        budgetMs: timeoutMs,
        operationHash,
        sessionKey: buildSandboxSessionKey({ groupId, sessionId, threadId, topicId, userId }),
      },
      async (workspace) => {
        const result = await workspace.runPython({ code, inputs, timeoutMs });
        const persisted = await persistSandboxOutputFiles({ db, files: result.files, userId });
        await workspace.markSynced(persisted.flatMap((file) => (file.fileId ? [file.fileId] : [])));
        return {
          files: persisted.length > 0 ? persisted : undefined,
          output: toOutput(result.stdout, result.stderr),
          success: result.success,
        };
      },
    );
  } catch (error) {
    if (error instanceof SandboxError) {
      return failedResponse(error.message);
    }
    return failedResponse(
      error instanceof Error ? error.message : 'Code Interpreter sandbox failed.',
    );
  }
};
