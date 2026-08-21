import { codeInterpreterEnv } from '@/envs/codeInterpreter';
import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import {
  createSandboxEnvelopeToken,
  parseSandboxEnvelope,
  wrapSandboxPython,
  type SandboxInputFile,
  type SandboxOutputFile,
} from './envelope';
import {
  CodeInterpreterSandboxError,
  type CodeInterpreterSandboxOutcome,
  type DifySandboxRunResponse,
} from './types';

export interface CodeInterpreterSandboxRunInput {
  code: string;
  files: SandboxInputFile[];
  operationHash?: string;
  packageCount?: number;
}

export interface CodeInterpreterSandboxRunResult {
  durationMs: number;
  exitCode?: number;
  files: SandboxOutputFile[];
  httpStatus?: number;
  outcome: CodeInterpreterSandboxOutcome;
  stderr: string;
  stdout: string;
  success: boolean;
}

const RUN_PATH = '/v1/sandbox/run';

/** True when a DifySandbox sibling is configured for this deployment. */
export const isCodeInterpreterSandboxConfigured = () =>
  !!codeInterpreterEnv.CODE_INTERPRETER_SANDBOX_URL;

const truncateChars = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…[output truncated]`;
};

const classifyFetchError = (error: unknown): CodeInterpreterSandboxError => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const timedOut =
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('timed out');
  if (timedOut) {
    return new CodeInterpreterSandboxError(
      'Timeout',
      `Code Interpreter sandbox timed out after ${codeInterpreterEnv.CODE_INTERPRETER_TIMEOUT}ms.`,
    );
  }
  return new CodeInterpreterSandboxError(
    'Unavailable',
    'Code Interpreter sandbox is unreachable.',
  );
};

export class CodeInterpreterSandboxService {
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

  async run(input: CodeInterpreterSandboxRunInput): Promise<CodeInterpreterSandboxRunResult> {
    const startedAt = Date.now();
    const fileInCount = input.files.length;
    const packageCount = input.packageCount ?? 0;
    const operationHash = input.operationHash;

    logGenerationDebugSafe('sandbox_run_started', {
      fileInCount,
      operationHash,
      packageCount,
      timeoutMs: this.timeout,
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
        'NotConfigured',
        'CODE_INTERPRETER_SANDBOX_URL is not set',
      );
    }

    const token = createSandboxEnvelopeToken();
    const wrapped = wrapSandboxPython({
      code: input.code,
      files: input.files,
      maxFileBytes: this.maxFileBytes,
      token,
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${RUN_PATH}`, {
        body: JSON.stringify({
          code: wrapped,
          enable_network: true,
          language: 'python3',
          preload: '',
        }),
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout),
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
        'Unavailable',
        'Code Interpreter sandbox is unavailable.',
        { httpStatus, outcome: 'unavailable' },
      );
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
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
        stdoutChars: 0,
        timeoutMs: this.timeout,
      });
      throw new CodeInterpreterSandboxError(
        'ExecutionFailed',
        'Code Interpreter sandbox rejected the run.',
        { httpStatus },
      );
    }

    const envelope = parseSandboxEnvelope({
      maxFileBytes: this.maxFileBytes,
      maxFileCount: this.maxFileCount,
      stdout: payload.data?.stdout ?? '',
      token,
    });
    const stderr = truncateChars(payload.data?.error?.trim() ?? '', this.maxStdoutChars);
    const stdout = truncateChars(envelope.stdout, this.maxStdoutChars);
    const success = envelope.wrapperPresent && envelope.success && !stderr;
    const outcome: CodeInterpreterSandboxOutcome = success ? 'ok' : 'error';

    logGenerationDebugSafe('sandbox_run_settled', {
      durationMs,
      exitCode,
      fileInCount,
      fileOutCount: envelope.files.length,
      httpStatus,
      operationHash,
      outcome,
      packageCount,
      stdoutChars: stdout.length,
      timeoutMs: this.timeout,
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
