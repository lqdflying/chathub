import { codeInterpreterEnv } from '@/envs/codeInterpreter';
import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import {
  SandboxError,
  type SandboxOutcome,
  type SandboxProvider,
  type SandboxRunInput,
  type SandboxRunResult,
} from '../../types';
import {
  createSandboxEnvelopeToken,
  parseSandboxEnvelope,
  wrapSandboxPreload,
  wrapSandboxPython,
} from './envelope';
import type { DifySandboxRunResponse } from './types';

const RUN_PATH = '/v1/sandbox/run';

const truncateChars = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…[output truncated]`;
};

const classifyFetchError = (error: unknown): SandboxError => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const timedOut =
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('timed out');
  if (timedOut) {
    return new SandboxError(
      'Timeout',
      `Code Interpreter sandbox timed out after ${codeInterpreterEnv.CODE_INTERPRETER_TIMEOUT}ms.`,
    );
  }
  return new SandboxError('Unavailable', 'Code Interpreter sandbox is unreachable.');
};

export class DifySandboxProvider implements SandboxProvider {
  readonly id = 'dify';
  private apiKey?: string;
  private baseUrl?: string;
  private maxFileBytes: number;
  private maxFileCount: number;
  private maxStdoutChars: number;
  private timeout: number;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    this.baseUrl = (options?.baseUrl ?? codeInterpreterEnv.CODE_INTERPRETER_SANDBOX_URL)?.replace(
      /\/+$/,
      '',
    );
    this.apiKey = options?.apiKey ?? codeInterpreterEnv.CODE_INTERPRETER_SANDBOX_API_KEY;
    this.timeout = codeInterpreterEnv.CODE_INTERPRETER_TIMEOUT;
    this.maxFileBytes = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_BYTES;
    this.maxFileCount = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_COUNT;
    this.maxStdoutChars = codeInterpreterEnv.CODE_INTERPRETER_MAX_STDOUT_CHARS;
  }

  isConfigured() {
    return !!this.baseUrl;
  }

  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    const fileInCount = input.files.length;
    const packageCount = input.packageCount ?? 0;
    const operationHash = input.operationHash;
    const timeoutMs = input.timeoutMs ?? this.timeout;

    logGenerationDebugSafe('sandbox_run_started', {
      fileInCount,
      operationHash,
      packageCount,
      provider: this.id,
      timeoutMs,
    });

    if (!this.baseUrl) {
      const durationMs = Date.now() - startedAt;
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        fileInCount,
        fileOutCount: 0,
        operationHash,
        outcome: 'not_configured',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError('NotConfigured', 'CODE_INTERPRETER_SANDBOX_URL is not set');
    }

    if (input.language !== 'python3') {
      throw new SandboxError('ExecutionFailed', 'DifySandbox only supports python3.');
    }

    const token = createSandboxEnvelopeToken();
    const wrapped = wrapSandboxPython({
      code: input.code,
      files: input.files.map((file) => ({
        contentBase64: Buffer.from(file.content).toString('base64'),
        filename: file.filename,
      })),
      maxFileBytes: this.maxFileBytes,
      token,
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${RUN_PATH}`, {
        body: JSON.stringify({
          code: wrapped,
          enable_network: input.enableNetwork !== false,
          language: 'python3',
          // Dify 0.2.10+ strips this unless the sidecar sets ENABLE_PRELOAD=true.
          // https://github.com/langgenius/dify-sandbox/blob/0.2.15/internal/service/python.go
          preload: wrapSandboxPreload(token),
        }),
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
        },
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const classified = classifyFetchError(error);
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs: Date.now() - startedAt,
        fileInCount,
        fileOutCount: 0,
        operationHash,
        outcome: classified.outcome,
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw classified;
    }

    const durationMs = Date.now() - startedAt;
    const httpStatus = response.status;

    if (httpStatus === 401) {
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        fileInCount,
        fileOutCount: 0,
        httpStatus,
        operationHash,
        outcome: 'error',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError(
        'Unauthorized',
        'Code Interpreter sandbox rejected the API key.',
        { httpStatus },
      );
    }

    if (httpStatus === 503) {
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        fileInCount,
        fileOutCount: 0,
        httpStatus,
        operationHash,
        outcome: 'unavailable',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError('Unavailable', 'Code Interpreter sandbox is unavailable.', {
        httpStatus,
        outcome: 'unavailable',
      });
    }

    if (!response.ok) {
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        fileInCount,
        fileOutCount: 0,
        httpStatus,
        operationHash,
        outcome: 'error',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError(
        'ExecutionFailed',
        `Code Interpreter sandbox returned HTTP ${httpStatus}.`,
        { httpStatus },
      );
    }

    let payload: DifySandboxRunResponse;
    try {
      payload = (await response.json()) as DifySandboxRunResponse;
    } catch {
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        fileInCount,
        fileOutCount: 0,
        httpStatus,
        operationHash,
        outcome: 'error',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError(
        'ExecutionFailed',
        'Code Interpreter sandbox returned a non-JSON body.',
        { httpStatus },
      );
    }

    const exitCode = typeof payload.code === 'number' ? payload.code : undefined;
    if (exitCode !== 0) {
      logGenerationDebugSafe('sandbox_run_settled', {
        durationMs,
        exitCode,
        fileInCount,
        fileOutCount: 0,
        httpStatus,
        operationHash,
        outcome: 'error',
        packageCount,
        provider: this.id,
        stdoutChars: 0,
        timeoutMs,
      });
      throw new SandboxError('ExecutionFailed', 'Code Interpreter sandbox rejected the run.', {
        httpStatus,
      });
    }

    const envelope = parseSandboxEnvelope({
      maxFileBytes: this.maxFileBytes,
      maxFileCount: this.maxFileCount,
      stdout: payload.data?.stdout ?? '',
      token,
    });
    const stderr = truncateChars(payload.data?.error?.trim() ?? '', this.maxStdoutChars);
    const stdout = truncateChars(envelope.stdout, this.maxStdoutChars);
    // Dify data.error is process stderr (warnings included), not a failure flag.
    // Real failures are wrapperPresent + sentinel success (Exception / non-zero sys.exit).
    const success = envelope.wrapperPresent && envelope.success;
    const outcome: SandboxOutcome = success ? 'ok' : 'error';

    logGenerationDebugSafe('sandbox_run_settled', {
      durationMs,
      exitCode,
      fileInCount,
      fileOutCount: envelope.files.length,
      httpStatus,
      operationHash,
      outcome,
      packageCount,
      provider: this.id,
      stdoutChars: stdout.length,
      timeoutMs,
    });

    return {
      durationMs,
      exitCode,
      files: envelope.files,
      httpStatus,
      outcome,
      stderr,
      stdout,
      success,
    };
  }
}
