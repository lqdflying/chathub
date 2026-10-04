import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

// The Sandbox tool was the Code Interpreter. Its CODE_INTERPRETER_* names are
// still read when the SANDBOX_* name is unset, so existing deployments keep
// their limits.
const withLegacy = (name: string, legacy: string) => process.env[name] ?? process.env[legacy];

export const getSandboxConfig = () =>
  createEnv({
    runtimeEnv: {
      OPENSANDBOX_API_KEY: process.env.OPENSANDBOX_API_KEY,
      OPENSANDBOX_CPU: process.env.OPENSANDBOX_CPU,
      OPENSANDBOX_EGRESS_ALLOW: process.env.OPENSANDBOX_EGRESS_ALLOW,
      OPENSANDBOX_IMAGE: process.env.OPENSANDBOX_IMAGE,
      OPENSANDBOX_MEMORY: process.env.OPENSANDBOX_MEMORY,
      OPENSANDBOX_READY_TIMEOUT: process.env.OPENSANDBOX_READY_TIMEOUT,
      OPENSANDBOX_SERVER_URL: process.env.OPENSANDBOX_SERVER_URL,
      OPENSANDBOX_SESSION_IDLE_TIMEOUT: process.env.OPENSANDBOX_SESSION_IDLE_TIMEOUT,
      OPENSANDBOX_SESSION_MAX_LIFETIME: process.env.OPENSANDBOX_SESSION_MAX_LIFETIME,
      SANDBOX_MAX_FILE_BYTES: withLegacy('SANDBOX_MAX_FILE_BYTES', 'CODE_INTERPRETER_MAX_FILE_BYTES'),
      SANDBOX_MAX_FILE_COUNT: withLegacy('SANDBOX_MAX_FILE_COUNT', 'CODE_INTERPRETER_MAX_FILE_COUNT'),
      SANDBOX_MAX_OUTPUT_CHARS: withLegacy(
        'SANDBOX_MAX_OUTPUT_CHARS',
        'CODE_INTERPRETER_MAX_STDOUT_CHARS',
      ),
      SANDBOX_MAX_TIMEOUT: process.env.SANDBOX_MAX_TIMEOUT,
      SANDBOX_TIMEOUT: withLegacy('SANDBOX_TIMEOUT', 'CODE_INTERPRETER_TIMEOUT'),
    },
    server: {
      // OpenSandbox lifecycle server API key (`OPEN-SANDBOX-API-KEY` header).
      OPENSANDBOX_API_KEY: z.string().optional(),
      // Per-sandbox hard caps, in Kubernetes quantity syntax.
      OPENSANDBOX_CPU: z.string().default('1'),
      // Comma-separated domains the sandbox may reach; everything else is denied.
      // Needs the egress sidecar (runc or Kata, not gVisor) and server network_mode
      // "bridge". Unset = no policy.
      OPENSANDBOX_EGRESS_ALLOW: z.string().optional(),
      // Sandbox image: python3 on PATH plus the runtimes and CLIs runs may use.
      OPENSANDBOX_IMAGE: z.string().optional(),
      OPENSANDBOX_MEMORY: z.string().default('2Gi'),
      // Budget for sandbox create + execd ready, in milliseconds. Commands run on SANDBOX_TIMEOUT.
      OPENSANDBOX_READY_TIMEOUT: z.coerce.number().int().positive().default(60_000),
      // Lifecycle server base URL, e.g. http://opensandbox:8090
      OPENSANDBOX_SERVER_URL: z.string().url().optional(),
      // Keep one sandbox per conversation (user, agent or group, topic, and portal
      // thread) for this long after its last call, so files, installs, and
      // background processes carry over between calls. 0 = a fresh sandbox for
      // every call. Milliseconds.
      OPENSANDBOX_SESSION_IDLE_TIMEOUT: z.coerce.number().int().min(0).default(1_800_000),
      // Optional cap on a session sandbox's age, counted from creation. 0 = no
      // cap: a sandbox lives while its conversation keeps using it and is
      // removed only after the idle timeout. With a cap, ChatHub never renews
      // one past it and the next call starts fresh. The server's
      // max_sandbox_timeout_seconds limits only the create TTL, not renewals,
      // so it cannot do this. Milliseconds.
      OPENSANDBOX_SESSION_MAX_LIFETIME: z.coerce.number().int().min(0).default(0),
      // Per-file cap for sandbox inputs, reads, and exported outputs (bytes).
      SANDBOX_MAX_FILE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 1024 * 1024),
      SANDBOX_MAX_FILE_COUNT: z.coerce.number().int().positive().default(20),
      // Characters of stdout and of stderr returned to the model per call.
      // Longer output keeps its head and tail.
      SANDBOX_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(30_000),
      // Upper bound for the per-call timeout the model may request. Milliseconds.
      SANDBOX_MAX_TIMEOUT: z.coerce.number().int().positive().default(600_000),
      // Default per-call time limit in milliseconds.
      SANDBOX_TIMEOUT: z.coerce.number().int().positive().default(60_000),
    },
  });

export const sandboxEnv = getSandboxConfig();
