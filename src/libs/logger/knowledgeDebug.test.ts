// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeKnowledgeDebugError,
  getKnowledgeDebugContext,
  logKnowledgeDebugSafe,
  logKnowledgeDebugVerbose,
  runWithKnowledgeDebugContext,
  runWithKnowledgeDebugOperation,
} from './knowledgeDebug';

const diagnosticId = 'kb_1234567890abcdef';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('knowledgeDebug', () => {
  it('emits nothing while disabled', () => {
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', '0');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logKnowledgeDebugSafe('retrieval_started', { phase: 'retrieval' });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('keeps safe records structured without raw content or private identifiers', () => {
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', '0123456789abcdef0123456789abcdef');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rawQuery = 'SENTINEL raw customer question';
    const rawFileId = 'file-private-123';

    runWithKnowledgeDebugContext(
      { diagnosticId, operation: 'chat_retrieval', runtime: 'lambda', transport: 'trpc' },
      () => {
        logKnowledgeDebugSafe('retrieval_started', {
          fileId: rawFileId,
          outcome: 'completed',
          phase: 'retrieval',
          promptTokens: 42,
          query: rawQuery,
        });
      },
    );

    const [prefix, json] = consoleSpy.mock.calls[0];
    expect(prefix).toBe('[chathub-knowledge-debug:retrieval_started]');
    expect(json).not.toContain(rawQuery);
    expect(json).not.toContain(rawFileId);
    const record = JSON.parse(json);
    expect(record).toMatchObject({
      diagnosticId,
      outcome: 'completed',
      phase: 'retrieval',
      promptTokens: 42,
      schemaVersion: 1,
    });
    expect(record.fileId).not.toHaveProperty('hash');
    expect(record.query).not.toHaveProperty('hash');
  });

  it('verbose records contain fingerprints and shapes but no raw payload or error message', () => {
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', 'verbose');
    vi.stubEnv('KEY_VAULTS_SECRET', '0123456789abcdef0123456789abcdef');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rawChunk = 'SENTINEL private chunk body';
    const rawError = 'SENTINEL provider secret response';

    runWithKnowledgeDebugContext({ diagnosticId }, () => {
      logKnowledgeDebugVerbose('embedding_provider_started', {
        chunks: [{ text: rawChunk }],
        inputTexts: [rawChunk],
        model: 'private-model-name',
      });
      logKnowledgeDebugSafe('embedding_provider_settled', {
        ...describeKnowledgeDebugError(new Error(rawError)),
        outcome: 'failed',
        phase: 'embedding_provider',
      });
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    expect(output).not.toContain(rawChunk);
    expect(output).not.toContain(rawError);
    expect(output).not.toContain('private-model-name');
    expect(output).toContain('hash');
    const record = JSON.parse(consoleSpy.mock.calls[0][1]);
    expect(record.payload.inputTexts).toMatchObject({ hash: expect.any(String), type: 'array' });
    expect(Buffer.byteLength(consoleSpy.mock.calls[0][1], 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });

  it('retains diagnostic context in a fire-and-forget promise continuation', async () => {
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', '1');
    let rejectDispatch!: (reason: Error) => void;
    const dispatch = new Promise<void>((_, reject) => {
      rejectDispatch = reject;
    });
    let continuationDiagnosticId: string | undefined;

    const taskId = await runWithKnowledgeDebugOperation(
      {
        diagnosticId,
        operation: 'chunking_task',
        runtime: 'lambda',
        transport: 'internal_http',
      },
      async () => {
        void dispatch.catch(() => {
          continuationDiagnosticId = getKnowledgeDebugContext()?.diagnosticId;
        });
        return 'task-1';
      },
    );

    expect(taskId).toBe('task-1');
    expect(continuationDiagnosticId).toBeUndefined();

    rejectDispatch(new Error('dispatch failed'));

    await vi.waitFor(() => expect(continuationDiagnosticId).toBe(diagnosticId));
  });

  it('replaces an oversized verbose record with bounded truncation metadata', () => {
    vi.stubEnv('CHATHUB_KNOWLEDGE_DEBUG', 'verbose');
    vi.stubEnv('KEY_VAULTS_SECRET', '0123456789abcdef0123456789abcdef');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const widePayload = Object.fromEntries(
      Array.from({ length: 48 }, (_, section) => [
        `section${section}`,
        Array.from({ length: 16 }, (_, item) =>
          Object.fromEntries(
            Array.from({ length: 48 }, (_, field) => [`field${field}`, section + item + field]),
          ),
        ),
      ]),
    );

    runWithKnowledgeDebugContext({ diagnosticId }, () => {
      logKnowledgeDebugVerbose('embedding_provider_started', widePayload);
    });

    const json = consoleSpy.mock.calls[0][1];
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(JSON.parse(json)).toMatchObject({ recordTruncated: true, schemaVersion: 1 });
  });
});
