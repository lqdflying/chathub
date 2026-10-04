/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/envs/codeInterpreter', () => ({
  codeInterpreterEnv: {
    CODE_INTERPRETER_MAX_FILE_BYTES: 1024,
    CODE_INTERPRETER_MAX_FILE_COUNT: 20,
    CODE_INTERPRETER_MAX_STDOUT_CHARS: 200_000,
    get CODE_INTERPRETER_TIMEOUT() {
      return Number(process.env.CODE_INTERPRETER_TIMEOUT ?? 60_000);
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
  logGenerationDebugSafe: vi.fn(),
}));

import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';

import { OPENSANDBOX_MANIFEST_MAX_BYTES } from '../client';
import { buildNetworkPolicy, OpenSandboxProvider } from '../provider';

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
  pingFailures?: number;
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
    uploads: [],
  };
  const states = [...(scenario.states ?? ['Running'])];
  const live = new Map<string, Omit<ExistingSandbox, 'id'>>(
    (scenario.existing ?? []).map(({ id, ...rest }) => [id, rest]),
  );

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
        .map(([id, { createdAt }]) => ({ createdAt, id, status: { state: 'Running' } }));
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
    if (rest === `${EXECD_PATH}/files/upload`) {
      const form = init.body as FormData;
      const metadata = form.getAll('metadata') as Blob[];
      const files = form.getAll('file') as Blob[];
      for (const [index, part] of metadata.entries()) {
        const { path: filePath } = JSON.parse(await part.text()) as { path: string };
        calls.uploads.push({ content: await files[index].text(), path: filePath });
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
      const content = scenario.files?.[filePath];
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
  '/tmp/chathub-ci/.chathub/manifest.json': JSON.stringify(entries),
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

const run = (code = 'x', files: ReturnType<typeof file>[] = []) =>
  new OpenSandboxProvider().run({ code, files, language: 'python3' });

const runIn = (sessionKey: string, code = 'x') =>
  new OpenSandboxProvider().run({ code, files: [], language: 'python3', sessionKey });

const session = (key: string) => ({
  'chathub-session': key,
  'name': 'chathub-code-interpreter',
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
    delete process.env.CODE_INTERPRETER_TIMEOUT;
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
        '/tmp/chathub-ci/chart.png': 'png',
        '/tmp/chathub-ci/notes.txt': 'edited',
      },
      states: ['Pending', 'Running'],
    });

    const result = await run('print("hello")', [
      file('data.csv', 'a,b'),
      file('nested/notes.txt', 'orig'),
    ]);

    expect(result).toMatchObject({
      exitCode: 0,
      outcome: 'ok',
      stderr: 'warn',
      stdout: 'hello\n42',
      success: true,
    });
    expect(result.files.map((item) => item.filename)).toEqual(['notes.txt', 'chart.png']);
    expect(Buffer.from(result.files[1].content).toString()).toBe('png');

    const [runner, code, ...inputs] = calls.uploads;
    expect(runner.path).toBe('/tmp/chathub-ci/.chathub/run.py');
    expect(runner.content).toContain('_PyplotHook');
    expect(code).toEqual({ content: 'print("hello")', path: '/tmp/chathub-ci/.chathub/code.py' });
    expect(inputs).toEqual([
      { content: 'a,b', path: '/tmp/chathub-ci/data.csv' },
      { content: 'orig', path: '/tmp/chathub-ci/notes.txt' },
    ]);
    expect(calls.commandBody).toEqual({
      command: 'python3 /tmp/chathub-ci/.chathub/run.py',
      cwd: '/tmp/chathub-ci',
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
      outcome: 'error',
      stderr: 'Traceback (most recent call last):\nZeroDivisionError: division by zero',
      success: false,
    });
  });

  it('treats an execd kill at the run timeout as a timeout', async () => {
    process.env.CODE_INTERPRETER_TIMEOUT = '40';
    const calls = install({
      command: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return stream([exitWith('-1', ['signal: killed'])]);
      },
    });

    await expect(run('while True: pass')).rejects.toMatchObject({
      code: 'Timeout',
      message: 'Code Interpreter sandbox timed out after 40ms.',
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
    process.env.CODE_INTERPRETER_TIMEOUT = '10';
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

    expect(calls.uploads.map((item) => item.path)).not.toContain('/tmp/chathub-ci/big.csv');
    expect(calls.downloads).toEqual(['/tmp/chathub-ci/.chathub/manifest.json']);
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
      downloads: { '/tmp/chathub-ci/big.bin': big.response },
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
      downloads: { '/tmp/chathub-ci/big.bin': big.response },
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
      downloads: { '/tmp/chathub-ci/exact.bin': exact.response },
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
      downloads: { '/tmp/chathub-ci/.chathub/manifest.json': huge.response },
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
      process.env.CODE_INTERPRETER_TIMEOUT = '40';
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
      expect(calls.createBody?.metadata).toEqual({ name: 'chathub-code-interpreter' });
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
          '/tmp/chathub-ci/new.png': 'new',
          '/tmp/chathub-ci/old.png': 'old',
        },
      });

      const result = await runIn('topic-a');

      expect(result.files.map((item) => item.filename)).toEqual(['new.png']);
      expect(calls.downloads).not.toContain('/tmp/chathub-ci/old.png');
    });
  });

  it('is not configured without both the server URL and the image', async () => {
    delete process.env.OPENSANDBOX_IMAGE;
    const provider = new OpenSandboxProvider();

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.run({ code: 'x', files: [], language: 'python3' })).rejects.toMatchObject(
      { code: 'NotConfigured', outcome: 'not_configured' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
