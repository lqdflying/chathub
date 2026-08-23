/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/envs/codeInterpreter', () => ({
  codeInterpreterEnv: {
    get CODE_INTERPRETER_MAX_FILE_BYTES() {
      return Number(process.env.CODE_INTERPRETER_MAX_FILE_BYTES ?? 10 * 1024 * 1024);
    },
    get CODE_INTERPRETER_MAX_FILE_COUNT() {
      return Number(process.env.CODE_INTERPRETER_MAX_FILE_COUNT ?? 20);
    },
    get CODE_INTERPRETER_MAX_STDOUT_CHARS() {
      return Number(process.env.CODE_INTERPRETER_MAX_STDOUT_CHARS ?? 200_000);
    },
    get CODE_INTERPRETER_SANDBOX_API_KEY() {
      return process.env.CODE_INTERPRETER_SANDBOX_API_KEY;
    },
    get CODE_INTERPRETER_SANDBOX_URL() {
      return process.env.CODE_INTERPRETER_SANDBOX_URL;
    },
    get CODE_INTERPRETER_TIMEOUT() {
      return Number(process.env.CODE_INTERPRETER_TIMEOUT ?? 60_000);
    },
    get SANDBOX_PROVIDER() {
      return process.env.SANDBOX_PROVIDER ?? 'dify';
    },
  },
}));

vi.mock('@/libs/logger/generationDebug', () => ({
  hashGenerationDebugValue: (value: string) => `hash:${value}`,
  logGenerationDebugSafe: vi.fn(),
}));

import { SandboxError } from '../../../types';
import { CI_FILES_SENTINEL_PREFIX } from '../envelope';
import { DifySandboxProvider } from '../provider';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const run = (provider: DifySandboxProvider, code = 'print(1)') =>
  provider.run({ code, files: [], language: 'python3' });

describe('DifySandboxProvider', () => {
  beforeEach(() => {
    process.env.CODE_INTERPRETER_SANDBOX_URL = 'http://code-interpreter:8194';
    process.env.CODE_INTERPRETER_SANDBOX_API_KEY = 'sandbox-secret';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    delete process.env.CODE_INTERPRETER_SANDBOX_URL;
    delete process.env.CODE_INTERPRETER_SANDBOX_API_KEY;
    vi.unstubAllGlobals();
  });

  it('posts python3 JSON with X-Api-Key to /v1/sandbox/run', async () => {
    const tokenNeedle = 'not-used';
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { code: string };
      const tokenMatch = /_TOKEN = "([0-9a-f]+)"/.exec(body.code);
      const token = tokenMatch?.[1] ?? tokenNeedle;
      return jsonResponse({
        code: 0,
        data: {
          error: '',
          stdout: `ok\n${CI_FILES_SENTINEL_PREFIX}${token}>>>\n${JSON.stringify({ files: [], success: true })}`,
        },
        message: 'success',
      });
    });

    const result = await run(new DifySandboxProvider());

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('ok');
    expect(result.outcome).toBe('ok');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://code-interpreter:8194/v1/sandbox/run');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Api-Key']).toBe('sandbox-secret');
    const body = JSON.parse(init.body as string);
    const tokenMatch = /_TOKEN = "([0-9a-f]+)"/.exec(body.code);
    expect(tokenMatch?.[1]).toBeTruthy();
    expect(body).toMatchObject({
      enable_network: true,
      language: 'python3',
    });
    expect(body.preload).toContain('os.makedirs(_path, mode=0o700, exist_ok=True)');
    expect(body.preload).toContain(tokenMatch![1]);
    expect(body.code).toContain('MPLBACKEND');
    expect(body.code).not.toContain('os.makedirs(');
    expect(body.code).not.toContain('print(1)');
  });

  it('throws not_configured when the sandbox URL is unset', async () => {
    delete process.env.CODE_INTERPRETER_SANDBOX_URL;
    await expect(run(new DifySandboxProvider())).rejects.toMatchObject({
      code: 'NotConfigured',
      outcome: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps HTTP 401 and 503', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(run(new DifySandboxProvider())).rejects.toBeInstanceOf(SandboxError);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(run(new DifySandboxProvider())).rejects.toMatchObject({
      code: 'Unavailable',
      httpStatus: 503,
    });
  });

  it('treats a missing wrapper sentinel as an execution error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 0, data: { error: '', stdout: 'partial' }, message: 'success' }),
    );
    const result = await run(new DifySandboxProvider());
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('error');
    expect(result.stdout).toBe('partial');
  });
});
