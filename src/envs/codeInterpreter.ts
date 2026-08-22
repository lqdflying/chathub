import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getCodeInterpreterConfig = () =>
  createEnv({
    runtimeEnv: {
      CODE_INTERPRETER_MAX_FILE_BYTES: process.env.CODE_INTERPRETER_MAX_FILE_BYTES,
      CODE_INTERPRETER_MAX_FILE_COUNT: process.env.CODE_INTERPRETER_MAX_FILE_COUNT,
      CODE_INTERPRETER_MAX_STDOUT_CHARS: process.env.CODE_INTERPRETER_MAX_STDOUT_CHARS,
      CODE_INTERPRETER_SANDBOX_API_KEY: process.env.CODE_INTERPRETER_SANDBOX_API_KEY,
      CODE_INTERPRETER_SANDBOX_URL: process.env.CODE_INTERPRETER_SANDBOX_URL,
      CODE_INTERPRETER_TIMEOUT: process.env.CODE_INTERPRETER_TIMEOUT,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    },
    server: {
      // Per-file cap for sandbox inputs and collected outputs (bytes).
      CODE_INTERPRETER_MAX_FILE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 1024 * 1024),
      CODE_INTERPRETER_MAX_FILE_COUNT: z.coerce.number().int().positive().default(20),
      CODE_INTERPRETER_MAX_STDOUT_CHARS: z.coerce.number().int().positive().default(200_000),
      // Must equal the sandbox container's API_KEY (`X-Api-Key`).
      CODE_INTERPRETER_SANDBOX_API_KEY: z.string().optional(),
      // Base URL of the DifySandbox sibling, e.g. http://code-interpreter:8194
      CODE_INTERPRETER_SANDBOX_URL: z.string().url().optional(),
      // Client-side abort in milliseconds. Match Compose WORKER_TIMEOUT (seconds).
      CODE_INTERPRETER_TIMEOUT: z.coerce.number().int().positive().default(60_000),
      // Backend selector. Only `dify` is implemented; unknown values stay boot-safe.
      SANDBOX_PROVIDER: z.string().default('dify'),
    },
  });

export const codeInterpreterEnv = getCodeInterpreterConfig();
