/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeConversationToolStep } from '@/server/services/conversationGeneration/tools';
import { invokeSandboxTool } from '@/server/services/sandbox/tool';
import { SandboxIdentifier } from '@/tools/sandbox/const';

const generationStepMocks = vi.hoisted(() => ({
  claimStep: vi.fn(),
  findCompletedStepByHash: vi.fn(),
  updateStep: vi.fn(),
}));
const messageStepMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findToolMessageByCall: vi.fn(),
  update: vi.fn(),
  updatePluginState: vi.fn(),
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    claimStep = generationStepMocks.claimStep;
    findCompletedStepByHash = generationStepMocks.findCompletedStepByHash;
    updateStep = generationStepMocks.updateStep;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = messageStepMocks.create;
    findToolMessageByCall = messageStepMocks.findToolMessageByCall;
    update = messageStepMocks.update;
    updatePluginState = messageStepMocks.updatePluginState;
  },
}));
vi.mock('@/server/services/sandbox/conversationFiles', () => ({
  listConversationSandboxInputs: async () => [],
  persistSandboxOutputFiles: async ({ files }: { files: Array<{ filename: string }> }) =>
    files.map((file, index) => ({
      fileId: `out-${index}`,
      filename: file.filename,
      url: `https://app.example/f/${file.filename}`,
    })),
}));
vi.mock('@/server/services/search', () => ({ SearchService: class {} }));
vi.mock('@/tools/web-browsing/ExecutionRuntime', () => ({
  WebBrowsingExecutionRuntime: class {},
}));

const fetchMock = vi.fn();

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: {
    SANDBOX_MAX_FILE_BYTES: 1024,
    SANDBOX_MAX_FILE_COUNT: 20,
    SANDBOX_MAX_OUTPUT_CHARS: 30_000,
    get SANDBOX_TIMEOUT() {
      return Number(process.env.SANDBOX_TIMEOUT ?? 60_000);
    },
    get OPENSANDBOX_API_KEY() {
      return process.env.OPENSANDBOX_API_KEY;
    },
    OPENSANDBOX_CPU: '1',
    get OPENSANDBOX_EGRESS_ALLOW() {
      return process.env.OPENSANDBOX_EGRESS_ALLOW;
    },
    get OPENSANDBOX_IMAGE() {
      return process.env.OPENSANDBOX_IMAGE;
    },
    OPENSANDBOX_MEMORY: '2Gi',
    OPENSANDBOX_READY_TIMEOUT: 5000,
    get OPENSANDBOX_SERVER_URL() {
      return process.env.OPENSANDBOX_SERVER_URL;
    },
    get OPENSANDBOX_SESSION_IDLE_TIMEOUT() {
      return Number(process.env.OPENSANDBOX_SESSION_IDLE_TIMEOUT ?? 1_800_000);
    },
    get OPENSANDBOX_SESSION_MAX_LIFETIME() {
      return Number(process.env.OPENSANDBOX_SESSION_MAX_LIFETIME ?? 0);
    },
  },
}));

vi.mock('@/libs/logger/generationDebug', () => ({
  hashGenerationDebugValue: (value: string) => value,
  logGenerationDebugSafe: vi.fn(),
}));

import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import type { SandboxWorkspace } from '../../../types';
import { OPENSANDBOX_MANIFEST_MAX_BYTES } from '../client';
import {
  buildNetworkPolicy,
  NETWORK_METADATA_KEY,
  OPEN_NETWORK_FINGERPRINT,
  OpenSandboxProvider,
  networkPolicyFingerprint,
  RUNTIME_METADATA_KEY,
  runtimeFingerprint,
} from '../provider';

const SERVER = 'http://opensandbox:8090';
const EXECD_PATH = '/proxy/44772';
const IDLE_MS = 1_800_000;
const MAX_LIFETIME_MS = 3_600_000;
// Default 60s run timeout plus the 120s TTL margin.
const RUN_BUDGET_MS = 180_000;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const stream = (events: unknown[]) =>
  new Response(events.map((event) => `${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });

const exitWith = (evalue: string, traceback = [`exit status ${evalue}`]) => ({
  error: { ename: 'CommandExecError', evalue, traceback },
  type: 'error',
});

interface DownloadState {
  cancelled: boolean;
  sent: number;
}

interface ExistingSandbox {
  createdAt?: string;
  id: string;
  metadata: Record<string, string>;
}

interface Scenario {
  command?: (init: RequestInit) => Promise<Response> | Response;
  create?: () => Response;
  list?: (init: RequestInit) => Promise<Response> | Response;
  // Sandboxes whose execd never answers.
  deadPings?: string[];
  downloads?: Record<string, () => Response>;
  // Sandboxes already running on the server.
  existing?: ExistingSandbox[];
  files?: Record<string, string>;
  // Uploads replace the initial files, and downloads read that store.
  persistUploads?: boolean;
  pingFailures?: number;
  // Extra execd routes; return undefined to fall through to the defaults.
  route?: (
    rest: string,
    url: URL,
    init: RequestInit,
  ) => Promise<Response | undefined> | Response | undefined;
  states?: string[];
}

interface Calls {
  commandBody?: Record<string, unknown>;
  commandIds: string[];
  createBody?: Record<string, unknown>;
  creates: number;
  deleted: number;
  deletedIds: string[];
  downloads: string[];
  headers: Array<Record<string, string>>;
  lists: Array<Record<string, string>>;
  pings: number;
  renewals: Array<{ expiresAt: number; id: string }>;
  uploadModes: number[];
  uploads: Array<{ content: string; path: string }>;
}

const install = (scenario: Scenario = {}) => {
  const calls: Calls = {
    commandIds: [],
    creates: 0,
    deleted: 0,
    deletedIds: [],
    downloads: [],
    headers: [],
    lists: [],
    pings: 0,
    renewals: [],
    uploadModes: [],
    uploads: [],
  };
  const states = [...(scenario.states ?? ['Running'])];
  const live = new Map<string, Omit<ExistingSandbox, 'id'>>(
    (scenario.existing ?? []).map(({ id, ...rest }) => [id, rest]),
  );
  const disk = new Map<string, string>(Object.entries(scenario.files ?? {}));

  fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.headers.push({ ...(init.headers as Record<string, string>) });
    expect(url.origin).toBe(SERVER);

    if (url.pathname === '/v1/sandboxes' && method === 'POST') {
      calls.createBody = JSON.parse(String(init.body));
      calls.creates += 1;
      const custom = scenario.create?.();
      if (custom) return custom;
      const id = `sbx-${calls.creates}`;
      const createdAt = new Date().toISOString();
      live.set(id, {
        createdAt,
        metadata: (calls.createBody?.metadata ?? {}) as Record<string, string>,
      });
      return json({ createdAt, id, status: { state: 'Pending' } });
    }
    if (url.pathname === '/v1/sandboxes' && method === 'GET') {
      const query = Object.fromEntries(url.searchParams);
      calls.lists.push(query);
      if (scenario.list) return scenario.list(init);
      const [key, value] = query.metadata.split('=');
      const items = [...live]
        .filter(([, sandbox]) => sandbox.metadata[key] === value)
        .map(([id, { createdAt, metadata }]) => ({
          createdAt,
          id,
          metadata,
          status: { state: 'Running' },
        }));
      return json({ items, pagination: { hasNextPage: false } });
    }

    const [, id, rest = ''] = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)(\/.*)?$/) ?? [];
    if (!id) throw new Error(`Unexpected request ${method} ${input}`);

    if (rest === '' && method === 'GET') {
      const state = states.length > 1 ? states.shift() : states[0];
      return json({ id, status: { message: 'image pull failed', state } });
    }
    if (rest === '' && method === 'DELETE') {
      calls.deleted += 1;
      calls.deletedIds.push(id);
      live.delete(id);
      return new Response(null, { status: 204 });
    }
    if (rest === '/renew-expiration' && method === 'POST') {
      const { expiresAt } = JSON.parse(String(init.body)) as { expiresAt: string };
      calls.renewals.push({ expiresAt: Date.parse(expiresAt), id });
      return json({ expiresAt });
    }
    if (rest === '/endpoints/44772') {
      expect(url.searchParams.get('use_server_proxy')).toBe('true');
      return json({ endpoint: `opensandbox:8090/v1/sandboxes/${id}${EXECD_PATH}` });
    }
    if (rest === `${EXECD_PATH}/ping`) {
      if (scenario.deadPings?.includes(id)) {
        return json({ message: 'Could not connect to the backend sandbox' }, 502);
      }
      calls.pings += 1;
      return calls.pings <= (scenario.pingFailures ?? 0)
        ? json({ message: 'Could not connect to the backend sandbox' }, 502)
        : new Response('pong');
    }
    const routed = await scenario.route?.(rest.replace(EXECD_PATH, ''), url, init);
    if (routed) return routed;
    if (rest === `${EXECD_PATH}/files/upload`) {
      const form = init.body as FormData;
      const metadata = form.getAll('metadata') as Blob[];
      const files = form.getAll('file') as Blob[];
      for (const [index, part] of metadata.entries()) {
        const { mode, path: filePath } = JSON.parse(await part.text()) as {
          mode: number;
          path: string;
        };
        const content = await files[index].text();
        calls.uploads.push({ content, path: filePath });
        calls.uploadModes.push(mode);
        if (scenario.persistUploads) disk.set(filePath, content);
      }
      return json({});
    }
    if (rest === `${EXECD_PATH}/command`) {
      calls.commandBody = JSON.parse(String(init.body));
      calls.commandIds.push(id);
      return (
        scenario.command?.(init) ??
        stream([{ text: 'ok', type: 'stdout' }, { type: 'execution_complete' }])
      );
    }
    if (rest === `${EXECD_PATH}/files/download`) {
      const filePath = url.searchParams.get('path') ?? '';
      calls.downloads.push(filePath);
      const custom = scenario.downloads?.[filePath];
      if (custom) return custom();
      const content = scenario.persistUploads ? disk.get(filePath) : scenario.files?.[filePath];
      return content === undefined
        ? json({ code: 'FILE_NOT_FOUND', message: 'file not found' }, 404)
        : new Response(content);
    }
    throw new Error(`Unexpected request ${method} ${input}`);
  });

  return calls;
};

const manifest = (
  entries: Array<{ changed?: boolean; name: string; sha256: string; size: number }>,
) => ({
  '/tmp/workspace/.chathub/manifest.json': JSON.stringify(entries),
});

const byteStream = (length: number, chunkSize: number, contentLength?: number) => {
  const state: DownloadState = { cancelled: false, sent: 0 };
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
    pull(controller) {
      if (sent >= length) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, length - sent);
      controller.enqueue(new Uint8Array(size));
      sent += size;
      state.sent = sent;
    },
  });
  const headers = contentLength === undefined ? undefined : { 'Content-Length': String(contentLength) };
  return { response: () => new Response(body, { headers }), state };
};

const file = (filename: string, content: string) => ({
  content: new Uint8Array(Buffer.from(content)),
  filename,
});

const inputsOf = (files: ReturnType<typeof file>[]) =>
  files.map((item) => ({ filename: item.filename, id: item.filename, load: async () => item.content }));

const runTimeout = () => Number(process.env.SANDBOX_TIMEOUT ?? 60_000);

const python = (
  provider: OpenSandboxProvider,
  {
    code = 'x',
    enableNetwork,
    files = [],
    sessionKey,
  }: {
    code?: string;
    enableNetwork?: boolean;
    files?: ReturnType<typeof file>[];
    sessionKey?: string;
  } = {},
) =>
  provider.withWorkspace(
    { apiName: 'runPython', budgetMs: runTimeout(), enableNetwork, sessionKey },
    (workspace) => workspace.runPython({ code, inputs: inputsOf(files), timeoutMs: runTimeout() }),
  );

const run = (code = 'x', files: ReturnType<typeof file>[] = []) =>
  python(new OpenSandboxProvider(), { code, files });

const runIn = (sessionKey: string, code = 'x') =>
  python(new OpenSandboxProvider(), { code, sessionKey });

const RUNTIME = runtimeFingerprint('chathub-sandbox:1');

const session = (key: string, network = OPEN_NETWORK_FINGERPRINT) => ({
  'chathub-network': network,
  'chathub-runtime': RUNTIME,
  'chathub-session': key,
  'name': 'chathub-sandbox',
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const settledFields = () =>
  vi
    .mocked(logGenerationDebugSafe)
    .mock.calls.filter(([event]) => event === 'sandbox_run_settled')
    .map(([, fields]) => fields);

describe('OpenSandboxProvider', () => {
  beforeEach(() => {
    process.env.OPENSANDBOX_SERVER_URL = SERVER;
    process.env.OPENSANDBOX_API_KEY = 'server-secret';
    process.env.OPENSANDBOX_IMAGE = 'chathub-sandbox:1';
    fetchMock.mockReset();
    vi.mocked(logGenerationDebugSafe).mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    delete process.env.OPENSANDBOX_SERVER_URL;
    delete process.env.OPENSANDBOX_API_KEY;
    delete process.env.OPENSANDBOX_IMAGE;
    delete process.env.OPENSANDBOX_EGRESS_ALLOW;
    delete process.env.SANDBOX_TIMEOUT;
    delete process.env.OPENSANDBOX_SESSION_IDLE_TIMEOUT;
    delete process.env.OPENSANDBOX_SESSION_MAX_LIFETIME;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs code in a fresh sandbox, returns new or changed files, and deletes it', async () => {
    const calls = install({
      command: () =>
        stream([
          { text: 'cmd-1', type: 'init' },
          { text: 'hello', type: 'stdout' },
          { text: 'warn', type: 'stderr' },
          { text: '42', type: 'stdout' },
          { type: 'execution_complete' },
        ]),
      files: {
        ...manifest([
          { name: 'data.csv', sha256: sha('a,b'), size: 3 },
          { name: 'notes.txt', sha256: sha('edited'), size: 6 },
          { name: 'chart.png', sha256: sha('png'), size: 3 },
        ]),
        '/tmp/workspace/chart.png': 'png',
        '/tmp/workspace/notes.txt': 'edited',
      },
      states: ['Pending', 'Running'],
    });

    const result = await run('print("hello")', [
      file('data.csv', 'a,b'),
      file('nested/notes.txt', 'orig'),
    ]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: 'warn',
      stdout: 'hello\n42',
      success: true,
    });
    expect(result.files.map((item) => item.filename)).toEqual(['notes.txt', 'chart.png']);
    expect(Buffer.from(result.files[1].content).toString()).toBe('png');

    const [runner, code, manifestReset, ...inputs] = calls.uploads;
    expect(runner.path).toBe('/tmp/workspace/.chathub/run.py');
    expect(runner.content).toContain('_PyplotHook');
    expect(code).toEqual({ content: 'print("hello")', path: '/tmp/workspace/.chathub/code.py' });
    expect(manifestReset).toEqual({ content: '[]', path: '/tmp/workspace/.chathub/manifest.json' });
    expect(inputs).toEqual([
      { content: 'a,b', path: '/tmp/workspace/data.csv' },
      { content: 'orig', path: '/tmp/workspace/notes.txt' },
      {
        content: JSON.stringify(['data.csv', 'nested/notes.txt']),
        path: '/tmp/workspace/.chathub/synced.json',
      },
    ]);
    expect(calls.commandBody).toEqual({
      command: 'python3 /tmp/workspace/.chathub/run.py',
      cwd: '/tmp/workspace',
      timeout: 60_000,
    });
    expect(calls.createBody).toMatchObject({
      entrypoint: ['tail', '-f', '/dev/null'],
      image: { uri: 'chathub-sandbox:1' },
      resourceLimits: { cpu: '1', memory: '2Gi' },
    });
    expect(calls.createBody).not.toHaveProperty('networkPolicy');
    expect(calls.headers.every((item) => item['OPEN-SANDBOX-API-KEY'] === 'server-secret')).toBe(
      true,
    );
    expect(calls.deleted).toBe(1);
  });

  it('waits for execd to answer /ping before uploading', async () => {
    const calls = install({ pingFailures: 2 });

    const result = await run();

    expect(result.success).toBe(true);
    expect(calls.pings).toBe(3);
  });

  it('reports a non-zero exit as a failed run and keeps stderr', async () => {
    install({
      command: () =>
        stream([
          { text: 'Traceback (most recent call last):', type: 'stderr' },
          { text: 'ZeroDivisionError: division by zero', type: 'stderr' },
          exitWith('1'),
        ]),
    });

    const result = await run('1/0');

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'Traceback (most recent call last):\nZeroDivisionError: division by zero',
      success: false,
    });
  });

  it('treats an execd kill at the run timeout as a timeout', async () => {
    process.env.SANDBOX_TIMEOUT = '40';
    const calls = install({
      command: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return stream([exitWith('-1', ['signal: killed'])]);
      },
    });

    await expect(run('while True: pass')).rejects.toMatchObject({
      code: 'Timeout',
      message: 'Sandbox timed out after 40ms.',
      outcome: 'timeout',
    });
    expect(calls.commandBody?.timeout).toBe(40);
    expect(calls.deleted).toBe(1);
  });

  it('reports an early kill as a failed run, not a timeout', async () => {
    install({ command: () => stream([exitWith('-1', ['signal: killed'])]) });

    const result = await run('x = bytearray(10**12)');

    expect(result.success).toBe(false);
    expect(result.stderr).toBe(
      'Process was killed before it finished (it may have run out of memory).',
    );
  });

  it('aborts when execd never settles the stream', async () => {
    process.env.SANDBOX_TIMEOUT = '10';
    const calls = install({
      command: (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });

    await expect(run()).rejects.toMatchObject({ code: 'Timeout' });
    expect(calls.deleted).toBe(1);
  }, 10_000);

  it('fails when the stream ends without a result event', async () => {
    install({ command: () => stream([{ text: 'partial', type: 'stdout' }]) });

    await expect(run()).rejects.toMatchObject({
      code: 'ExecutionFailed',
      message: 'OpenSandbox ended the run without a result.',
    });
  });

  it('maps a rejected API key to Unauthorized', async () => {
    install({ create: () => json({ code: 'UNAUTHORIZED', message: 'bad key' }, 401) });

    await expect(run()).rejects.toMatchObject({ code: 'Unauthorized', httpStatus: 401 });
  });

  it('fails fast when the sandbox does not start, and still deletes it', async () => {
    const calls = install({ states: ['Pending', 'Failed'] });

    await expect(run()).rejects.toMatchObject({
      code: 'Unavailable',
      message: 'OpenSandbox sandbox failed to start (Failed: image pull failed).',
    });
    expect(calls.deleted).toBe(1);
  });

  it('keeps output when the manifest is missing', async () => {
    install();

    expect(await run('print(1)')).toMatchObject({ files: [], stdout: 'ok', success: true });
  });

  it('skips inputs and outputs over the per-file cap', async () => {
    const big = 'x'.repeat(2048);
    const calls = install({
      files: manifest([{ name: 'big.bin', sha256: sha(big), size: big.length }]),
    });

    const result = await run('x', [file('big.csv', big)]);

    expect(calls.uploads.map((item) => item.path)).not.toContain('/tmp/workspace/big.csv');
    expect(calls.downloads).toEqual(['/tmp/workspace/.chathub/manifest.json']);
    expect(result.files).toEqual([]);
  });

  it('ignores manifest names that are not plain basenames', async () => {
    const calls = install({
      files: manifest([{ name: '../etc/passwd', sha256: 'x', size: 4 }]),
    });

    expect((await run()).files).toEqual([]);
    expect(calls.downloads).toHaveLength(1);
  });

  it('sends a deny-by-default network policy when an allowlist is configured', async () => {
    process.env.OPENSANDBOX_EGRESS_ALLOW = 'pypi.org, files.pythonhosted.org';
    const calls = install();

    await run();

    expect(calls.createBody?.networkPolicy).toEqual({
      defaultAction: 'deny',
      egress: [
        { action: 'allow', target: 'pypi.org' },
        { action: 'allow', target: 'files.pythonhosted.org' },
      ],
    });
  });

  it('stops reading a forged-small output once it passes the file cap', async () => {
    const big = byteStream(2 * 1024 * 1024, 64 * 1024, 1);
    const calls = install({
      downloads: { '/tmp/workspace/big.bin': big.response },
      files: manifest([{ name: 'big.bin', sha256: 'guest-controlled', size: 1 }]),
    });

    const result = await run('x');

    expect(result).toMatchObject({ files: [], success: true });
    expect(big.state.cancelled).toBe(true);
    expect(big.state.sent).toBeGreaterThan(0);
    expect(big.state.sent).toBeLessThan(2 * 1024 * 1024);
    expect(big.state.sent).toBeLessThanOrEqual(128 * 1024);
    expect(calls.deleted).toBe(1);
  });

  it('rejects a declared oversized body before reading it', async () => {
    const big = byteStream(2 * 1024 * 1024, 64 * 1024, 2 * 1024 * 1024);
    const calls = install({
      downloads: { '/tmp/workspace/big.bin': big.response },
      files: manifest([{ name: 'big.bin', sha256: 'guest-controlled', size: 1 }]),
    });

    const result = await run('x');

    expect(result.files).toEqual([]);
    expect(big.state.sent).toBeLessThan(2 * 1024 * 1024);
    expect(big.state.sent).toBeLessThanOrEqual(64 * 1024);
    expect(big.state.cancelled).toBe(true);
    expect(calls.deleted).toBe(1);
  });

  it('accepts a file that is exactly the per-file cap', async () => {
    const exact = byteStream(1024, 512);
    const calls = install({
      downloads: { '/tmp/workspace/exact.bin': exact.response },
      files: manifest([{ name: 'exact.bin', sha256: 'x', size: 1024 }]),
    });

    const result = await run('x');

    expect(exact.state).toEqual({ cancelled: false, sent: 1024 });
    expect(result.files.map((item) => item.content.byteLength)).toEqual([1024]);
    expect(calls.deleted).toBe(1);
  });

  it('stops reading an oversized manifest', async () => {
    const full = OPENSANDBOX_MANIFEST_MAX_BYTES + 1024 * 1024;
    const huge = byteStream(full, 64 * 1024);
    const calls = install({
      downloads: { '/tmp/workspace/.chathub/manifest.json': huge.response },
    });

    const result = await run('x');

    expect(result.files).toEqual([]);
    expect(huge.state.cancelled).toBe(true);
    expect(huge.state.sent).toBeGreaterThan(OPENSANDBOX_MANIFEST_MAX_BYTES);
    expect(huge.state.sent).toBeLessThan(full);
    expect(calls.deleted).toBe(1);
  });

  describe('session sandboxes', () => {
    it('tags a new session sandbox and parks it for the idle timeout', async () => {
      const calls = install();
      const before = Date.now();

      await runIn('topic-a');

      expect(calls.lists).toEqual([{ metadata: 'chathub-session=topic-a', state: 'Running' }]);
      expect(calls.createBody?.metadata).toEqual(session('topic-a'));
      expect(calls.deleted).toBe(0);
      expect(calls.renewals).toHaveLength(1);
      expect(calls.renewals[0].id).toBe('sbx-1');
      expect(calls.renewals[0].expiresAt).toBeGreaterThanOrEqual(before + IDLE_MS);
      expect(calls.renewals[0].expiresAt).toBeLessThanOrEqual(Date.now() + IDLE_MS);
    });

    it('deletes other running sandboxes for the same session after reuse', async () => {
      const calls = install({
        existing: [
          { createdAt: ago(60_000), id: 'sbx-keep', metadata: session('topic-a') },
          { createdAt: ago(30_000), id: 'sbx-extra', metadata: session('topic-a') },
        ],
      });

      await runIn('topic-a');

      expect(calls.creates).toBe(0);
      expect(calls.commandIds).toEqual(['sbx-keep']);
      expect(calls.deletedIds).toEqual(['sbx-extra']);
    });

    it('reuses the running sandbox of the same session', async () => {
      const calls = install();

      await runIn('topic-a', 'import subprocess; subprocess.run(["pip", "install", "pyarrow"])');
      await runIn('topic-a', 'import pyarrow');

      expect(calls.creates).toBe(1);
      expect(calls.commandIds).toEqual(['sbx-1', 'sbx-1']);
      expect(calls.deleted).toBe(0);
      // Park after run 1, cover run 2, park after run 2.
      expect(calls.renewals.map((item) => item.id)).toEqual(['sbx-1', 'sbx-1', 'sbx-1']);
      expect(calls.renewals[1].expiresAt - Date.now()).toBeLessThanOrEqual(RUN_BUDGET_MS);
      expect(calls.renewals[1].expiresAt - Date.now()).toBeGreaterThan(RUN_BUDGET_MS - 5000);
      expect(settledFields()).toMatchObject([
        { outcome: 'ok', sandboxRetired: false, sandboxReused: false, sessionScoped: true },
        { outcome: 'ok', sandboxRetired: false, sandboxReused: true, sessionScoped: true },
      ]);
    });

    it('keeps different sessions in different sandboxes', async () => {
      const calls = install();

      await runIn('topic-a');
      await runIn('topic-b');

      expect(calls.creates).toBe(2);
      expect(calls.commandIds).toEqual(['sbx-1', 'sbx-2']);
    });

    it('replaces a session sandbox whose execd no longer answers', async () => {
      const calls = install({
        deadPings: ['sbx-old'],
        existing: [{ createdAt: ago(60_000), id: 'sbx-old', metadata: session('topic-a') }],
      });

      expect((await runIn('topic-a')).success).toBe(true);
      expect(calls.deletedIds).toEqual(['sbx-old']);
      expect(calls.commandIds).toEqual(['sbx-1']);
    });

    it('keeps reusing an active session sandbox at any age without a max lifetime', async () => {
      const calls = install({
        existing: [{ createdAt: ago(5 * MAX_LIFETIME_MS), id: 'sbx-old', metadata: session('topic-a') }],
      });

      await runIn('topic-a');
      const parkedAt = Date.now();

      expect(calls.commandIds).toEqual(['sbx-old']);
      expect(calls.deleted).toBe(0);
      expect(calls.renewals.at(-1)?.id).toBe('sbx-old');
      expect(calls.renewals.at(-1)!.expiresAt).toBeGreaterThan(parkedAt + IDLE_MS - 5000);
      expect(calls.renewals.at(-1)!.expiresAt).toBeLessThanOrEqual(parkedAt + IDLE_MS);
      expect(settledFields()).toMatchObject([{ sandboxRetired: false, sandboxReused: true }]);
    });

    it('reuses a session sandbox whose creation time is unknown without a max lifetime', async () => {
      const calls = install({ existing: [{ id: 'sbx-old', metadata: session('topic-a') }] });

      await runIn('topic-a');

      expect(calls.commandIds).toEqual(['sbx-old']);
      expect(calls.deleted).toBe(0);
    });

    describe('with a max lifetime', () => {
      beforeEach(() => {
        process.env.OPENSANDBOX_SESSION_MAX_LIFETIME = String(MAX_LIFETIME_MS);
      });

      it('retires a session sandbox too close to its max lifetime to host the run', async () => {
        const calls = install({
          existing: [
            {
              createdAt: ago(MAX_LIFETIME_MS - RUN_BUDGET_MS + 5000),
              id: 'sbx-old',
              metadata: session('topic-a'),
            },
          ],
        });

        await runIn('topic-a');

        expect(calls.deletedIds).toEqual(['sbx-old']);
        expect(calls.renewals.map((item) => item.id)).toEqual(['sbx-1']);
        expect(calls.commandIds).toEqual(['sbx-1']);
        expect(settledFields()).toMatchObject([{ sandboxRetired: true, sandboxReused: false }]);
      });

      it('retires a session sandbox whose creation time is unknown', async () => {
        const calls = install({ existing: [{ id: 'sbx-old', metadata: session('topic-a') }] });

        await runIn('topic-a');

        expect(calls.deletedIds).toEqual(['sbx-old']);
        expect(calls.commandIds).toEqual(['sbx-1']);
      });

      it('never renews a session sandbox past its max lifetime', async () => {
        const createdAt = ago(MAX_LIFETIME_MS - 10 * 60_000);
        const calls = install({
          existing: [{ createdAt, id: 'sbx-old', metadata: session('topic-a') }],
        });

        await runIn('topic-a');

        expect(calls.commandIds).toEqual(['sbx-old']);
        expect(calls.deleted).toBe(0);
        // Idle timeout (30 min) would pass the cap (10 min left), so the cap wins.
        expect(calls.renewals.at(-1)).toEqual({
          expiresAt: Date.parse(createdAt) + MAX_LIFETIME_MS,
          id: 'sbx-old',
        });
      });

      it('deletes a session sandbox after a run once no further run fits its lifetime', async () => {
        vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
        const calls = install({
          command: () => {
            vi.setSystemTime(Date.now() + 10_000);
            return stream([{ type: 'execution_complete' }]);
          },
          existing: [
            {
              createdAt: ago(MAX_LIFETIME_MS - RUN_BUDGET_MS - 5000),
              id: 'sbx-old',
              metadata: session('topic-a'),
            },
          ],
        });

        await runIn('topic-a');

        expect(calls.commandIds).toEqual(['sbx-old']);
        expect(calls.deletedIds).toEqual(['sbx-old']);
        expect(calls.renewals.map((item) => item.id)).toEqual(['sbx-old']);
      });
    });

    it('creates a fresh session sandbox when the lookup fails', async () => {
      const calls = install({ list: () => json({ code: 'NOT_FOUND', message: 'no route' }, 404) });

      expect((await runIn('topic-a')).success).toBe(true);
      expect(calls.createBody?.metadata).toEqual(session('topic-a'));
      expect(settledFields()).toMatchObject([{ sandboxLookupFailed: true, sandboxReused: false }]);
    });

    it('fails the run when the lookup outlives the ready budget', async () => {
      const calls = install({
        list: (init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      });

      await expect(runIn('topic-a')).rejects.toMatchObject({
        code: 'Unavailable',
        message: 'OpenSandbox sandbox was not ready within 5000ms.',
      });
      expect(calls.creates).toBe(0);
    }, 10_000);

    it('deletes a session sandbox after an infrastructure failure', async () => {
      const calls = install({ command: () => stream([{ text: 'partial', type: 'stdout' }]) });

      await expect(runIn('topic-a')).rejects.toMatchObject({ code: 'ExecutionFailed' });
      expect(calls.deletedIds).toEqual(['sbx-1']);
      expect(calls.renewals).toEqual([]);
    });

    it('keeps a session sandbox after a run timeout', async () => {
      process.env.SANDBOX_TIMEOUT = '40';
      const calls = install({
        command: async () => {
          await sleep(60);
          return stream([exitWith('-1', ['signal: killed'])]);
        },
      });

      await expect(runIn('topic-a')).rejects.toMatchObject({ code: 'Timeout' });
      expect(calls.deleted).toBe(0);
      expect(calls.renewals.map((item) => item.id)).toEqual(['sbx-1']);
    });

    it('uses a fresh sandbox per run when the idle timeout is 0', async () => {
      process.env.OPENSANDBOX_SESSION_IDLE_TIMEOUT = '0';
      const calls = install();

      await runIn('topic-a');

      expect(calls.lists).toEqual([]);
      expect(calls.createBody?.metadata).toEqual({
        name: 'chathub-sandbox',
        [NETWORK_METADATA_KEY]: OPEN_NETWORK_FINGERPRINT,
        [RUNTIME_METADATA_KEY]: RUNTIME,
      });
      expect(calls.deletedIds).toEqual(['sbx-1']);
    });

    it('runs concurrent calls of one session one at a time in one sandbox', async () => {
      let active = 0;
      let peak = 0;
      const calls = install({
        command: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(20);
          active -= 1;
          return stream([{ type: 'execution_complete' }]);
        },
      });

      await Promise.all([runIn('topic-a', 'a'), runIn('topic-a', 'b')]);

      expect(calls.creates).toBe(1);
      expect(peak).toBe(1);
      expect(calls.commandIds).toEqual(['sbx-1', 'sbx-1']);
    });

    it('returns only files the run created or changed', async () => {
      const calls = install({
        files: {
          ...manifest([
            { changed: false, name: 'old.png', sha256: sha('old'), size: 3 },
            { changed: true, name: 'new.png', sha256: sha('new'), size: 3 },
          ]),
          '/tmp/workspace/new.png': 'new',
          '/tmp/workspace/old.png': 'old',
        },
      });

      const result = await runIn('topic-a');

      expect(result.files.map((item) => item.filename)).toEqual(['new.png']);
      expect(calls.downloads).not.toContain('/tmp/workspace/old.png');
    });

    it('replaces a reused sandbox when the network policy is tightened', async () => {
      const calls = install();

      await runIn('topic-a');
      process.env.OPENSANDBOX_EGRESS_ALLOW = 'pypi.org';
      await python(new OpenSandboxProvider(), { sessionKey: 'topic-a' });

      expect(calls.creates).toBe(2);
      expect(calls.deletedIds).toContain('sbx-1');
      expect(calls.commandIds).toEqual(['sbx-1', 'sbx-2']);
      expect(calls.createBody?.networkPolicy).toEqual({
        defaultAction: 'deny',
        egress: [{ action: 'allow', target: 'pypi.org' }],
      });
      expect(calls.createBody?.metadata).toMatchObject({
        [NETWORK_METADATA_KEY]: networkPolicyFingerprint(
          buildNetworkPolicy(undefined, ['pypi.org']),
        ),
      });
    });

    it('replaces a reused sandbox when networking is turned off', async () => {
      const calls = install();
      const provider = () => new OpenSandboxProvider();

      await python(provider(), { enableNetwork: true, sessionKey: 'topic-a' });
      await python(provider(), { enableNetwork: false, sessionKey: 'topic-a' });

      expect(calls.creates).toBe(2);
      expect(calls.deletedIds).toContain('sbx-1');
      expect(calls.createBody?.networkPolicy).toEqual({ defaultAction: 'deny', egress: [] });
    });

    it('reuses a sandbox when the network policy is unchanged', async () => {
      process.env.OPENSANDBOX_EGRESS_ALLOW = 'pypi.org';
      const calls = install();

      await runIn('topic-a', 'first');
      await python(new OpenSandboxProvider(), { code: 'second', sessionKey: 'topic-a' });

      expect(calls.creates).toBe(1);
      expect(calls.deleted).toBe(0);
      expect(calls.commandIds).toEqual(['sbx-1', 'sbx-1']);
    });

    it('replaces a legacy sandbox that has no policy label when a policy is required', async () => {
      process.env.OPENSANDBOX_EGRESS_ALLOW = 'pypi.org';
      const calls = install({
        existing: [
          {
            createdAt: ago(60_000),
            id: 'sbx-old',
            metadata: {
              'chathub-runtime': RUNTIME,
              'chathub-session': 'topic-a',
              'name': 'chathub-sandbox',
            },
          },
        ],
      });

      await runIn('topic-a');

      expect(calls.deletedIds).toContain('sbx-old');
      expect(calls.creates).toBe(1);
      expect(calls.commandIds).toEqual(['sbx-1']);
    });

    it('does not attach a previous run\'s files when the process exits before the manifest', async () => {
      const previous = Array.from({ length: 21 }, (_, index) => ({
        changed: true as const,
        name: `result_${index}.txt`,
        sha256: sha(`v${index}`),
        size: String(index).length + 1,
      }));
      const files: Record<string, string> = {
        '/tmp/workspace/.chathub/manifest.json': JSON.stringify(previous),
      };
      for (const [index, entry] of previous.entries()) {
        files[`/tmp/workspace/${entry.name}`] = `v${index}`;
      }
      const calls = install({
        command: () => stream([{ type: 'execution_complete' }]),
        files,
        persistUploads: true,
      });

      const result = await python(new OpenSandboxProvider(), {
        code: 'import os; os._exit(0)',
        files: previous.slice(0, 20).map((entry, index) => file(entry.name, `v${index}`)),
        sessionKey: 'topic-a',
      });

      expect(result).toMatchObject({ files: [], success: true });
      expect(calls.uploads).toContainEqual({
        content: '[]',
        path: '/tmp/workspace/.chathub/manifest.json',
      });
      expect(calls.downloads).toEqual(['/tmp/workspace/.chathub/manifest.json']);
    });
  });

  describe('workspace operations', () => {
    const useIn = <T>(
      sessionKey: string | undefined,
      task: (workspace: SandboxWorkspace) => Promise<T>,
      options: { createIfMissing?: boolean; signal?: AbortSignal } = {},
    ) =>
      new OpenSandboxProvider().withWorkspace(
        { apiName: 'test', budgetMs: runTimeout(), sessionKey, ...options },
        task,
      );

    it('runs a shell command in the workdir and returns its exit code', async () => {
      const calls = install({
        command: () =>
          stream([
            { text: 'cmd-1', type: 'init' },
            { text: 'v24.0.0', type: 'stdout' },
            { text: 'warning', type: 'stderr' },
            exitWith('3'),
          ]),
      });

      const result = await useIn('topic-a', (workspace) =>
        workspace.exec({ command: 'node --version; exit 3', timeoutMs: 5000 }),
      );

      expect(result).toMatchObject({
        exitCode: 3,
        killed: false,
        stderr: 'warning',
        stdout: 'v24.0.0',
        timedOut: false,
      });
      expect(calls.commandBody).toEqual({
        command: 'node --version; exit 3',
        cwd: '/tmp/workspace',
        timeout: 5000,
      });
      // A failing command leaves a healthy sandbox.
      expect(calls.deleted).toBe(0);
      expect(settledFields()).toMatchObject([{ exitCode: 3, operation: 'test', outcome: 'error' }]);
    });

    it('returns partial output when a command hits its time limit', async () => {
      const calls = install({
        command: async () => {
          await sleep(40);
          return stream([{ text: 'step 1', type: 'stdout' }, exitWith('-1', ['signal: killed'])]);
        },
      });

      const result = await useIn('topic-a', (workspace) =>
        workspace.exec({ command: 'sleep 999', cwd: '/srv', timeoutMs: 30 }),
      );

      expect(result).toMatchObject({ killed: false, stdout: 'step 1', timedOut: true });
      expect(calls.commandBody?.cwd).toBe('/srv');
      expect(calls.deleted).toBe(0);
      expect(settledFields()).toMatchObject([{ outcome: 'timeout' }]);
    });

    it('keeps the head and tail of long output', async () => {
      const lines = Array.from({ length: 4000 }, (_, index) => ({
        text: `line ${index}`,
        type: 'stdout',
      }));
      install({ command: () => stream([...lines, { type: 'execution_complete' }]) });

      const { stdout } = await useIn(undefined, (workspace) =>
        workspace.exec({ command: 'seq', timeoutMs: 5000 }),
      );

      expect(stdout.startsWith('line 0\nline 1\n')).toBe(true);
      expect(stdout.endsWith('line 3998\nline 3999')).toBe(true);
      expect(stdout).toMatch(/…\[\d+ characters omitted\]…/);
      expect(stdout.length).toBeLessThan(30_000 + 100);
    });

    it('starts a background command and reads its status, logs, and stop', async () => {
      const seen: string[] = [];
      const calls = install({
        command: () =>
          stream([{ text: 'bg-7', type: 'init' }, { type: 'execution_complete' }]),
        route: (rest, url, init) => {
          seen.push(`${init.method ?? 'GET'} ${rest}${url.search}`);
          if (rest === '/command/status/bg-7') return json({ id: 'bg-7', running: true });
          if (rest === '/command/bg-7/logs') {
            return new Response('listening on 3000\n', {
              headers: { 'EXECD-COMMANDS-TAIL-CURSOR': '18' },
            });
          }
          if (rest === '/command' && init.method === 'DELETE') return new Response(null);
          return undefined;
        },
      });

      const result = await useIn('topic-a', async (workspace) => {
        const id = await workspace.startBackground({ command: 'node server.js' });
        const status = await workspace.commandStatus(id);
        const logs = await workspace.commandLogs(id, 5);
        await workspace.interrupt(id);
        return { id, logs, status };
      });

      expect(result).toEqual({
        id: 'bg-7',
        logs: { cursor: 18, output: 'listening on 3000\n' },
        status: { error: undefined, exitCode: undefined, running: true },
      });
      expect(calls.commandBody).toEqual({
        background: true,
        command: 'node server.js',
        cwd: '/tmp/workspace',
      });
      expect(seen).toEqual([
        'POST /command',
        'GET /command/status/bg-7',
        'GET /command/bg-7/logs?cursor=5',
        'DELETE /command?id=bg-7',
      ]);
    });

    it('reports an unknown command id without discarding the sandbox', async () => {
      const calls = install({
        route: (rest) =>
          rest === '/command/status/gone'
            ? json({ code: 'INVALID_REQUEST', message: 'command not found: gone' }, 404)
            : undefined,
      });

      await expect(
        useIn('topic-a', (workspace) => workspace.commandStatus('gone')),
      ).rejects.toMatchObject({
        code: 'ExecutionFailed',
        message: 'No background command gone in this sandbox. Its sandbox may have been replaced.',
        name: 'SandboxRequestError',
      });
      expect(calls.deleted).toBe(0);
      expect(calls.renewals.map((item) => item.id)).toEqual(['sbx-1']);
    });

    it('reads a file after checking it exists and fits the cap', async () => {
      const infos: string[] = [];
      const calls = install({
        files: { '/tmp/workspace/app.ts': 'export {}' },
        route: (rest, url) => {
          if (rest !== '/files/info') return undefined;
          const path = url.searchParams.get('path')!;
          infos.push(path);
          if (path === '/tmp/workspace/app.ts') {
            return json({ [path]: { mode: 644, path, size: 9, type: 'file' } });
          }
          if (path === '/tmp/workspace/src') {
            return json({ [path]: { mode: 755, path, size: 0, type: 'directory' } });
          }
          if (path === '/tmp/workspace/huge.log') {
            return json({ [path]: { mode: 644, path, size: 4096, type: 'file' } });
          }
          return json({ code: 'FILE_NOT_FOUND', message: 'file not found' }, 404);
        },
      });

      const results = await useIn('topic-a', async (workspace) => {
        const text = Buffer.from(await workspace.readFile('/tmp/workspace/app.ts', 1024)).toString();
        const errors = [];
        for (const path of ['/tmp/workspace/missing', '/tmp/workspace/src', '/tmp/workspace/huge.log']) {
          errors.push(await workspace.readFile(path, 1024).catch((error: Error) => error.message));
        }
        return { errors, text };
      });

      expect(results.text).toBe('export {}');
      expect(results.errors).toEqual([
        'File not found: /tmp/workspace/missing',
        '/tmp/workspace/src is a directory. Use listFiles to see its contents.',
        '/tmp/workspace/huge.log is 4096 bytes, over the 1024-byte limit. Read part of it with runCommand (head, tail, sed -n).',
      ]);
      expect(calls.downloads).toEqual(['/tmp/workspace/app.ts']);
      expect(calls.deleted).toBe(0);
    });

    it('writes a file and keeps an existing file mode', async () => {
      const calls = install({
        route: (rest, url) => {
          if (rest !== '/files/info') return undefined;
          const path = url.searchParams.get('path')!;
          return path === '/tmp/workspace/run.sh'
            ? json({ [path]: { mode: 755, path, size: 4, type: 'file' } })
            : json({ code: 'FILE_NOT_FOUND', message: 'file not found' }, 404);
        },
      });

      await useIn('topic-a', async (workspace) => {
        await workspace.writeFile('/tmp/workspace/run.sh', new Uint8Array(Buffer.from('echo')));
        await workspace.writeFile('/tmp/workspace/new/notes.md', new Uint8Array(Buffer.from('# hi')));
      });

      expect(calls.uploads).toEqual([
        { content: 'echo', path: '/tmp/workspace/run.sh' },
        { content: '# hi', path: '/tmp/workspace/new/notes.md' },
      ]);
      expect(calls.uploadModes).toEqual([755, 644]);
    });

    it('lists a directory with execd metadata', async () => {
      install({
        route: (rest, url) =>
          rest === '/directories/list'
            ? json(
                url.searchParams.get('depth') === '2'
                  ? [
                      { mode: 755, modified_at: '2026-10-04T00:00:00Z', path: '/w/src', size: 0, type: 'directory' },
                      { mode: 644, path: '/w/src/a.ts', size: 12, type: 'file' },
                      { path: '/w/link', size: 0, type: 'symlink' },
                      { size: 1 },
                    ]
                  : [],
              )
            : undefined,
      });

      const entries = await useIn(undefined, (workspace) => workspace.listDirectory('/w', 2));

      expect(entries).toEqual([
        { mode: 755, modifiedAt: '2026-10-04T00:00:00Z', path: '/w/src', size: 0, type: 'directory' },
        { mode: 644, modifiedAt: undefined, path: '/w/src/a.ts', size: 12, type: 'file' },
        { mode: undefined, modifiedAt: undefined, path: '/w/link', size: 0, type: 'symlink' },
      ]);
    });

    it('uploads only conversation files a reused sandbox does not have yet', async () => {
      const loads: string[] = [];
      const calls = install({ persistUploads: true });
      const ref = (id: string, filename: string, content: string) => ({
        filename,
        id,
        load: async () => {
          loads.push(id);
          return new Uint8Array(Buffer.from(content));
        },
      });

      await useIn('topic-a', (workspace) => workspace.syncInputs([ref('f1', 'data.csv', 'a,b')]));
      await useIn('topic-a', async (workspace) => {
        await workspace.syncInputs([
          ref('f2', 'report.pdf', 'pdf'),
          ref('f1', 'data.csv', 'a,b'),
          ref('f0', 'data.csv', 'older'),
        ]);
        await workspace.markSynced(['out-1']);
      });

      expect(loads).toEqual(['f1', 'f2']);
      expect(calls.uploads).toEqual([
        { content: 'a,b', path: '/tmp/workspace/data.csv' },
        { content: '["f1"]', path: '/tmp/workspace/.chathub/synced.json' },
        { content: 'pdf', path: '/tmp/workspace/report.pdf' },
        { content: '["f1","f2"]', path: '/tmp/workspace/.chathub/synced.json' },
        { content: '["f1","f2","out-1"]', path: '/tmp/workspace/.chathub/synced.json' },
      ]);
      // Only the reused sandbox reads the record; a new one has nothing yet.
      expect(calls.downloads).toEqual(['/tmp/workspace/.chathub/synced.json']);
    });

    it('fails with NotFound instead of creating a sandbox when told not to', async () => {
      const calls = install();

      await expect(
        useIn('topic-a', (workspace) => workspace.commandStatus('bg-1'), {
          createIfMissing: false,
        }),
      ).rejects.toMatchObject({ code: 'NotFound' });
      expect(calls.creates).toBe(0);
    });

    it('replaces a parked sandbox that runs a different image or layout', async () => {
      const calls = install({
        existing: [
          {
            createdAt: ago(60_000),
            id: 'sbx-old',
            metadata: { ...session('topic-a'), [RUNTIME_METADATA_KEY]: runtimeFingerprint('old:1') },
          },
          {
            createdAt: ago(60_000),
            id: 'sbx-legacy',
            metadata: {
              'chathub-network': OPEN_NETWORK_FINGERPRINT,
              'chathub-session': 'topic-a',
              'name': 'chathub-code-interpreter',
            },
          },
        ],
      });

      await runIn('topic-a');

      expect(calls.deletedIds).toEqual(['sbx-old', 'sbx-legacy']);
      expect(calls.commandIds).toEqual(['sbx-1']);
      expect(settledFields()).toMatchObject([{ sandboxRetired: true, sandboxReused: false }]);
    });

    it('stops the command and keeps the sandbox when the caller cancels', async () => {
      const controller = new AbortController();
      const interrupts: string[] = [];
      const calls = install({
        command: (init) => {
          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(encoder.encode(`${JSON.stringify({ text: 'cmd-9', type: 'init' })}\n\n`));
              init.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
              setTimeout(() => controller.abort(), 20);
            },
          });
          return new Response(body);
        },
        route: (rest, url, init) => {
          if (rest === '/command' && init.method === 'DELETE') {
            interrupts.push(url.searchParams.get('id')!);
            return new Response(null);
          }
          return undefined;
        },
      });

      await expect(
        useIn('topic-a', (workspace) => workspace.exec({ command: 'sleep 60', timeoutMs: 60_000 }), {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'Cancelled' });
      expect(interrupts).toEqual(['cmd-9']);
      expect(calls.deleted).toBe(0);
    });
  });

  it('is not configured without both the server URL and the image', async () => {
    delete process.env.OPENSANDBOX_IMAGE;
    const provider = new OpenSandboxProvider();

    expect(provider.isConfigured()).toBe(false);
    await expect(python(provider)).rejects.toMatchObject({
      code: 'NotConfigured',
      outcome: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Stop during Python manifest and output downloads', async () => {
    const manifestController = new AbortController();
    install({
      command: () => stream([{ text: 'done', type: 'stdout' }, { type: 'execution_complete' }]),
      route: (rest, url, init) => {
        if (rest === '/files/download' && url.searchParams.get('path')?.endsWith('/manifest.json')) {
          manifestController.abort();
          init.signal?.throwIfAborted();
          throw new Error('The workspace did not forward cancellation');
        }
      },
    });

    await expect(
      invokeSandboxTool({
        apiName: 'runPython',
        args: { code: 'print("done")' },
        db: {} as any,
        sessionId: 'agent-1',
        signal: manifestController.signal,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'Cancelled' });

    const fileController = new AbortController();
    install({
      command: () => stream([{ text: 'done', type: 'stdout' }, { type: 'execution_complete' }]),
      files: {
        ...manifest([{ changed: true, name: 'out.txt', sha256: sha('out'), size: 3 }]),
        '/tmp/workspace/out.txt': 'out',
      },
      route: (rest, url, init) => {
        if (rest === '/files/download' && url.searchParams.get('path')?.endsWith('/out.txt')) {
          fileController.abort();
          init.signal?.throwIfAborted();
          throw new Error('The workspace did not forward cancellation');
        }
      },
    });

    await expect(
      invokeSandboxTool({
        apiName: 'runPython',
        args: { code: 'print("done")' },
        db: {} as any,
        sessionId: 'agent-1',
        signal: fileController.signal,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'Cancelled' });
  });

  it('rejects Stop during the post-run sync upload without a tool result', async () => {
    const controller = new AbortController();
    install({
      command: () => stream([{ text: 'done', type: 'stdout' }, { type: 'execution_complete' }]),
      files: {
        ...manifest([{ changed: true, name: 'out.txt', sha256: sha('out'), size: 3 }]),
        '/tmp/workspace/out.txt': 'out',
      },
      route: async (rest, _url, init) => {
        if (rest !== '/files/upload' || !(init.body instanceof FormData)) return;
        const metadata = init.body.getAll('metadata') as Blob[];
        for (const part of metadata) {
          const parsed = JSON.parse(await part.text()) as { path?: string };
          if (parsed.path?.endsWith('/synced.json')) {
            controller.abort();
            init.signal?.throwIfAborted();
            throw new Error('The workspace did not forward cancellation');
          }
        }
        return json({});
      },
    });

    await expect(
      invokeSandboxTool({
        apiName: 'runPython',
        args: { code: 'print("done")' },
        db: {} as any,
        sessionId: 'agent-1',
        signal: controller.signal,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'Cancelled' });
  });

  it('still returns stdout when output collection fails without Stop', async () => {
    install();

    await expect(
      invokeSandboxTool({
        apiName: 'runPython',
        args: { code: 'print(1)' },
        db: {} as any,
        sessionId: 'agent-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      output: [{ data: 'ok', type: 'stdout' }],
      success: true,
    });
  });

  it('does not persist a durable tool result when Stop hits output collection', async () => {
    generationStepMocks.findCompletedStepByHash.mockResolvedValue(undefined);
    generationStepMocks.claimStep.mockResolvedValue({ id: 'step-1' });
    generationStepMocks.updateStep.mockClear().mockResolvedValue({ id: 'step-1' });
    messageStepMocks.create.mockClear().mockResolvedValue({ id: 'tool-1' });
    messageStepMocks.findToolMessageByCall.mockResolvedValue(undefined);
    const controller = new AbortController();
    install({
      command: () => stream([{ text: 'done', type: 'stdout' }, { type: 'execution_complete' }]),
      route: (rest, url, init) => {
        if (rest === '/files/download' && url.searchParams.get('path')?.endsWith('/manifest.json')) {
          controller.abort();
          init.signal?.throwIfAborted();
          throw new Error('The workspace did not forward cancellation');
        }
      },
    });

    await expect(
      executeConversationToolStep({
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          sessionId: 'agent-1',
          topicId: 'topic-1',
        } as any,
        attempt: 1,
        db: {} as any,
        operationId: 'operation-1',
        payload: {
          apiName: 'runPython',
          arguments: JSON.stringify({ code: 'print("done")' }),
          id: 'tool-1',
          identifier: SandboxIdentifier,
          type: 'builtin',
        } as any,
        signal: controller.signal,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'Cancelled' });

    expect(messageStepMocks.create).not.toHaveBeenCalled();
    expect(generationStepMocks.updateStep).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(generationStepMocks.updateStep).not.toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });
});

describe('buildNetworkPolicy', () => {
  it('denies everything when the run disables network', () => {
    expect(buildNetworkPolicy(false, ['pypi.org'])).toEqual({ defaultAction: 'deny', egress: [] });
  });

  it('sends no policy by default', () => {
    expect(buildNetworkPolicy(undefined, [])).toBeUndefined();
  });
});
