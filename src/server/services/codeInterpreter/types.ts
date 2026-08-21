export type CodeInterpreterSandboxOutcome =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'unavailable'
  | 'not_configured';

export type CodeInterpreterErrorCode =
  | 'NotConfigured'
  | 'Timeout'
  | 'Unavailable'
  | 'ExecutionFailed'
  | 'Unauthorized';

export const sandboxOutcomeFromErrorCode = (
  code: CodeInterpreterErrorCode,
): CodeInterpreterSandboxOutcome => {
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

export class CodeInterpreterSandboxError extends Error {
  readonly code: CodeInterpreterErrorCode;
  readonly httpStatus?: number;
  readonly outcome: CodeInterpreterSandboxOutcome;

  constructor(
    code: CodeInterpreterErrorCode,
    message: string,
    options?: { httpStatus?: number; outcome?: CodeInterpreterSandboxOutcome },
  ) {
    super(message);
    this.name = 'CodeInterpreterSandboxError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.outcome = options?.outcome ?? sandboxOutcomeFromErrorCode(code);
  }
}

export interface DifySandboxRunResponse {
  code?: number;
  data?: {
    error?: string | null;
    stdout?: string | null;
  };
  message?: string;
}
