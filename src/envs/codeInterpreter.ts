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
      OPENSANDBOX_API_KEY: process.env.OPENSANDBOX_API_KEY,
      OPENSANDBOX_CPU: process.env.OPENSANDBOX_CPU,
      OPENSANDBOX_EGRESS_ALLOW: process.env.OPENSANDBOX_EGRESS_ALLOW,
      OPENSANDBOX_IMAGE: process.env.OPENSANDBOX_IMAGE,
      OPENSANDBOX_MEMORY: process.env.OPENSANDBOX_MEMORY,
      OPENSANDBOX_READY_TIMEOUT: process.env.OPENSANDBOX_READY_TIMEOUT,
      OPENSANDBOX_SERVER_URL: process.env.OPENSANDBOX_SERVER_URL,
      OPENSANDBOX_SESSION_IDLE_TIMEOUT: process.env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
      OPENSANDBOX_SESSION_MAX_LIFETIME: process.env.OPENSANDBOX_SESSION_MAX_LIFETIME,
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
      // OpenSandbox lifecycle server API key (`OPEN-SANDBOX-API-KEY` header).
      OPENSANDBOX_API_KEY: z.string().optional(),
      // Per-sandbox hard caps, in Kubernetes quantity syntax.
      OPENSANDBOX_CPU: z.string().default('1'),
      // Comma-separated domains the sandbox may reach; everything else is denied.
      // Needs the egress sidecar (runc or Kata, not gVisor) and server network_mode
      // "bridge". Unset = no policy.
      OPENSANDBOX_EGRESS_ALLOW: z.string().optional(),
      // Sandbox image with python3 on PATH plus the libraries runs may import.
      OPENSANDBOX_IMAGE: z.string().optional(),
      OPENSANDBOX_MEMORY: z.string().default('2Gi'),
      // Budget for sandbox create + execd ready, in milliseconds. Code runs on CODE_INTERPRETER_TIMEOUT.
      OPENSANDBOX_READY_TIMEOUT: z.coerce.number().int().positive().default(60_000),
      // Lifecycle server base URL, e.g. http://opensandbox:8090
      OPENSANDBOX_SERVER_URL: z.string().url().optional(),
      // Keep one sandbox per topic (or portal thread) for this long after its last
      // run, so installs and files carry over between calls. 0 = a fresh sandbox
      // for every run. Milliseconds.
      OPENSANDBOX_SESSION_IDLE_TIMEOUT: z.coerce.number().int().min(0).default(1_800_000),
      // Optional cap on a session sandbox's age, counted from creation. 0 = no
      // cap: a sandbox lives while its conversation keeps running code and is
      // removed only after the idle timeout. With a cap, ChatHub never renews
      // one past it and the next run starts fresh. The server's
      // max_sandbox_timeout_seconds limits only the create TTL, not renewals,
      // so it cannot do this. Milliseconds.
      OPENSANDBOX_SESSION_MAX_LIFETIME: z.coerce.number().int().min(0).default(0),
      // Backend selector: `dify` or `opensandbox`. Unknown values stay boot-safe.
      SANDBOX_PROVIDER: z.string().default('dify'),
    },
  });

export const codeInterpreterEnv = getCodeInterpreterConfig();
