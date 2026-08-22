export type SandboxLanguage = 'python3';

export type SandboxOutcome = 'ok' | 'error' | 'timeout' | 'unavailable' | 'not_configured';

export type SandboxErrorCode =
  | 'NotConfigured'
  | 'Timeout'
  | 'Unavailable'
  | 'ExecutionFailed'
  | 'Unauthorized';

export interface SandboxFile {
  content: Uint8Array;
  filename: string;
}

export interface SandboxRunInput {
  code: string;
  enableNetwork?: boolean;
  files: SandboxFile[];
  language: SandboxLanguage;
  operationHash?: string;
  packageCount?: number;
  timeoutMs?: number;
}

export interface SandboxRunResult {
  durationMs: number;
  exitCode?: number;
  files: SandboxFile[];
  httpStatus?: number;
  outcome: SandboxOutcome;
  stderr: string;
  stdout: string;
  success: boolean;
}

export const sandboxOutcomeFromErrorCode = (code: SandboxErrorCode): SandboxOutcome => {
  switch (code) {
    case 'NotConfigured': {
      return 'not_configured';
    }
    case 'Timeout': {
      return 'timeout';
    }
    case 'Unavailable': {
      return 'unavailable';
    }
    default: {
      return 'error';
    }
  }
};

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly httpStatus?: number;
  readonly outcome: SandboxOutcome;

  constructor(
    code: SandboxErrorCode,
    message: string,
    options?: { httpStatus?: number; outcome?: SandboxOutcome },
  ) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.outcome = options?.outcome ?? sandboxOutcomeFromErrorCode(code);
  }
}

export interface SandboxProvider {
  readonly id: string;
  isConfigured(): boolean;
  run(input: SandboxRunInput): Promise<SandboxRunResult>;
}
