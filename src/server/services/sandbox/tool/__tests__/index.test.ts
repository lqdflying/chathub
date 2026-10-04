/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SandboxError, SandboxRequestError, type SandboxWorkspace } from '../../types';

const mocks = vi.hoisted(() => ({
  keepsSessions: true,
  listInputs: vi.fn(),
  persist: vi.fn(),
  withWorkspace: vi.fn(),
}));

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: {
    SANDBOX_MAX_FILE_BYTES: 64,
    SANDBOX_MAX_FILE_COUNT: 3,
    SANDBOX_MAX_OUTPUT_CHARS: 30_000,
    SANDBOX_MAX_TIMEOUT: 600_000,
    SANDBOX_TIMEOUT: 60_000,
  },
}));
vi.mock('../../registry', () => ({
  getSandboxProvider: () => ({
    get keepsSessions() {
      return mocks.keepsSessions;
    },
    withWorkspace: mocks.withWorkspace,
  }),
}));
vi.mock('../../conversationFiles', () => ({
  listConversationSandboxInputs: mocks.listInputs,
  persistSandboxOutputFiles: mocks.persist,
}));
vi.mock('@/server/services/conversationGeneration/inboxSession', () => ({
  toPersistedConversationSessionId: (id?: string | null) => id ?? undefined,
}));

import { invokeSandboxTool } from '../index';

const WORKDIR = '/tmp/workspace';
const bytes = (value: string) => new Uint8Array(Buffer.from(value));

const fakeWorkspace = (overrides: Partial<SandboxWorkspace> = {}) => {
  const workspace = {
    commandLogs: vi.fn(async () => ({ cursor: 12, output: 'ready\n' })),
    commandStatus: vi.fn(async () => ({ running: true })),
    exec: vi.fn(async () => ({
      durationMs: 5,
      exitCode: 0,
      killed: false,
      stderr: '',
      stdout: 'ok',
      timedOut: false,
    })),
    fileInfo: vi.fn(),
    fresh: false,
    interrupt: vi.fn(async () => undefined),
    listDirectory: vi.fn(async () => []),
    markSynced: vi.fn(async () => undefined),
    readFile: vi.fn(async () => bytes('')),
    runPython: vi.fn(async () => ({ files: [], stderr: '', stdout: '1', success: true })),
    startBackground: vi.fn(async () => 'cmd-1'),
    syncInputs: vi.fn(async () => undefined),
    workdir: WORKDIR,
    writeFile: vi.fn(async () => undefined),
    ...overrides,
  };
  return workspace as typeof workspace & SandboxWorkspace;
};

let workspace: ReturnType<typeof fakeWorkspace>;
const inputs = [{ filename: 'data.csv', id: 'file-1', load: async () => bytes('a,b') }];

const call = (apiName: string, args: Record<string, unknown>) =>
  invokeSandboxTool({
    apiName,
    args,
    db: {} as any,
    sessionId: 'agent-1',
    topicId: 'topic-1',
    userId: 'user-1',
  });

describe('invokeSandboxTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keepsSessions = true;
    workspace = fakeWorkspace();
    mocks.listInputs.mockResolvedValue(inputs);
    mocks.persist.mockImplementation(async ({ files }: { files: Array<{ filename: string }> }) =>
      files.map((file, index) => ({
        fileId: `out-${index}`,
        filename: file.filename,
        url: `https://app.example/f/${file.filename}`,
      })),
    );
    mocks.withWorkspace.mockImplementation(async (_options, task) => task(workspace));
  });

  it('rejects unknown APIs and invalid arguments without touching the sandbox', async () => {
    expect(await call('format_disk', {})).toEqual({
      error: 'Unknown Sandbox API "format_disk".',
      success: false,
    });
    expect(await call('readFile', {})).toMatchObject({
      error: expect.stringContaining('Invalid arguments for readFile: path:'),
      success: false,
    });
    expect(mocks.withWorkspace).not.toHaveBeenCalled();
  });

  it('runs a foreground command with conversation files and a clamped time limit', async () => {
    const result = await call('runCommand', {
      command: 'npm test',
      cwd: 'app',
      timeout: '5000',
    });

    expect(result).toEqual({
      durationMs: 5,
      exitCode: 0,
      stderr: '',
      stdout: 'ok',
      success: true,
    });
    expect(workspace.syncInputs).toHaveBeenCalledWith(inputs);
    expect(workspace.exec).toHaveBeenCalledWith({
      command: 'npm test',
      cwd: '/tmp/workspace/app',
      timeoutMs: 600_000,
    });
    expect(mocks.withWorkspace.mock.calls[0][0]).toMatchObject({
      apiName: 'runCommand',
      budgetMs: 600_000,
      sessionKey: expect.stringMatching(/^[\da-f]{32}$/),
    });
  });

  it('marks a timed-out or failing command as unsuccessful and says what to do', async () => {
    workspace.exec.mockResolvedValueOnce({
      durationMs: 60_000,
      exitCode: undefined as unknown as number,
      killed: false,
      stderr: '',
      stdout: 'partial',
      timedOut: true,
    });

    const result = await call('runCommand', { command: 'sleep 999' });

    expect(result).toMatchObject({ stdout: 'partial', success: false, timedOut: true });
    expect(result.hint).toContain('60s time limit');
  });

  it('starts background commands only when sandboxes persist', async () => {
    expect(await call('runCommand', { background: 'true', command: 'node server.js' })).toEqual({
      background: true,
      commandId: 'cmd-1',
      hint: expect.any(String),
      success: true,
    });

    mocks.keepsSessions = false;
    expect(await call('runCommand', { background: true, command: 'node server.js' })).toMatchObject({
      error: expect.stringContaining('OPENSANDBOX_SESSION_IDLE_TIMEOUT=0'),
      success: false,
    });
  });

  it('reads background output from the existing sandbox only', async () => {
    expect(await call('getCommandOutput', { commandId: 'cmd-1', cursor: 4 })).toEqual({
      commandId: 'cmd-1',
      exitCode: undefined,
      log: 'ready\n',
      nextCursor: 12,
      running: true,
      success: true,
    });
    expect(workspace.commandLogs).toHaveBeenCalledWith('cmd-1', 4);
    expect(workspace.syncInputs).not.toHaveBeenCalled();
    expect(mocks.listInputs).not.toHaveBeenCalled();
    expect(mocks.withWorkspace.mock.calls[0][0]).toMatchObject({ createIfMissing: false });

    expect(await call('stopCommand', { commandId: 'cmd-1' })).toEqual({
      commandId: 'cmd-1',
      success: true,
    });
    expect(workspace.interrupt).toHaveBeenCalledWith('cmd-1');
  });

  it('reports a missing sandbox as a failed call', async () => {
    mocks.withWorkspace.mockRejectedValueOnce(
      new SandboxError('NotFound', 'This conversation has no running sandbox.'),
    );

    expect(await call('getCommandOutput', { commandId: 'cmd-1' })).toEqual({
      error: 'This conversation has no running sandbox.',
      success: false,
    });
  });

  it('reads text with line numbers and reports binary files', async () => {
    workspace.readFile.mockResolvedValueOnce(bytes('one\ntwo\nthree\n'));

    expect(await call('readFile', { limit: 2, offset: 2, path: 'notes.txt' })).toEqual({
      content: '     2\ttwo\n     3\tthree',
      endLine: 3,
      path: '/tmp/workspace/notes.txt',
      startLine: 2,
      success: true,
      totalLines: 3,
      truncated: false,
    });
    expect(workspace.readFile).toHaveBeenCalledWith('/tmp/workspace/notes.txt', 64);

    workspace.readFile.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]));
    expect(await call('readFile', { path: '/srv/logo.png' })).toMatchObject({
      binary: true,
      path: '/srv/logo.png',
      size: 5,
      success: true,
    });
  });

  it('writes files within the size cap', async () => {
    expect(await call('writeFile', { content: 'hello', path: 'src/a.ts' })).toEqual({
      bytes: 5,
      path: '/tmp/workspace/src/a.ts',
      success: true,
    });
    expect(workspace.writeFile).toHaveBeenCalledWith('/tmp/workspace/src/a.ts', bytes('hello'));

    expect(await call('writeFile', { content: 'x'.repeat(65), path: 'big.txt' })).toMatchObject({
      error: 'The content is 65 bytes, over the 64-byte limit.',
      success: false,
    });
  });

  it('edits one exact match and refuses ambiguous or missing ones', async () => {
    workspace.readFile.mockResolvedValue(bytes('let a = 1;\nlet b = 1;\n'));

    expect(await call('editFile', { newString: 'x', oldString: 'zzz', path: 'a.js' })).toMatchObject({
      error: expect.stringContaining('was not found'),
      success: false,
    });
    expect(await call('editFile', { newString: '2', oldString: '1', path: 'a.js' })).toMatchObject({
      error: expect.stringContaining('appears 2 times'),
      success: false,
    });
    expect(workspace.writeFile).not.toHaveBeenCalled();

    expect(
      await call('editFile', { newString: 'let b = "$&";', oldString: 'let b = 1;', path: 'a.js' }),
    ).toEqual({ path: '/tmp/workspace/a.js', replacements: 1, success: true });
    expect(Buffer.from(workspace.writeFile.mock.calls[0][1]).toString()).toBe(
      'let a = 1;\nlet b = "$&";\n',
    );

    expect(
      await call('editFile', { newString: '2', oldString: '1', path: 'a.js', replaceAll: true }),
    ).toMatchObject({ replacements: 2, success: true });
    expect(Buffer.from(workspace.writeFile.mock.calls[1][1]).toString()).toBe(
      'let a = 2;\nlet b = 2;\n',
    );
  });

  it('lists a directory without ChatHub control files and caps the entries', async () => {
    workspace.listDirectory.mockResolvedValueOnce([
      { path: '/tmp/workspace/.chathub', size: 0, type: 'directory' },
      { path: '/tmp/workspace/.chathub/run.py', size: 9, type: 'file' },
      { path: '/tmp/workspace/src', size: 0, type: 'directory' },
      { path: '/tmp/workspace/src/a.ts', size: 12, type: 'file' },
    ]);

    expect(await call('listFiles', { depth: 9 })).toEqual({
      entries: [
        { path: '/tmp/workspace/src', type: 'directory' },
        { path: '/tmp/workspace/src/a.ts', size: 12, type: 'file' },
      ],
      path: '/tmp/workspace',
      success: true,
    });
    expect(workspace.listDirectory).toHaveBeenCalledWith('/tmp/workspace', 5);

    workspace.listDirectory.mockResolvedValueOnce(
      Array.from({ length: 501 }, (_, index) => ({
        path: `/tmp/workspace/f${index}`,
        size: 1,
        type: 'file' as const,
      })),
    );
    const capped = await call('listFiles', { path: '.' });
    expect(capped.entries).toHaveLength(500);
    expect(capped).toMatchObject({ truncated: true });
  });

  it('exports files, skips unreadable ones, and records them as synced', async () => {
    workspace.readFile.mockImplementation(async (path: string) => {
      if (path === '/tmp/workspace/dist/report.pdf') return bytes('%PDF');
      if (path === '/tmp/workspace/empty.txt') return bytes('');
      throw new SandboxRequestError(`File not found: ${path}`);
    });

    const result = await call('exportFile', {
      paths: ['dist/report.pdf', 'missing.csv', 'empty.txt', 'dist/report.pdf'],
    });

    expect(result).toEqual({
      files: [
        { fileId: 'out-0', filename: 'report.pdf', url: 'https://app.example/f/report.pdf' },
      ],
      skipped: [
        'missing.csv: File not found: /tmp/workspace/missing.csv',
        'empty.txt: the file is empty',
      ],
      success: true,
    });
    expect(workspace.markSynced).toHaveBeenCalledWith(['out-0']);
  });

  it('keeps the Code Interpreter shape for runPython and the legacy python API', async () => {
    workspace.runPython.mockResolvedValueOnce({
      files: [{ content: bytes('png'), filename: 'plot_1.png' }],
      stderr: 'warn',
      stdout: 'done',
      success: true,
    });

    expect(await call('python', { code: 'print(1)', packages: [] })).toEqual({
      files: [{ fileId: 'out-0', filename: 'plot_1.png', url: 'https://app.example/f/plot_1.png' }],
      output: [
        { data: 'done', type: 'stdout' },
        { data: 'warn', type: 'stderr' },
      ],
      success: true,
    });
    expect(workspace.runPython).toHaveBeenCalledWith({
      code: 'print(1)',
      inputs,
      timeoutMs: 60_000,
    });
    expect(workspace.markSynced).toHaveBeenCalledWith(['out-0']);

    mocks.withWorkspace.mockRejectedValueOnce(new SandboxError('Timeout', 'Sandbox timed out.'));
    expect(await call('runPython', { code: 'while True: pass' })).toEqual({
      output: [{ data: 'Sandbox timed out.', type: 'stderr' }],
      success: false,
    });
    expect(await call('runPython', { code: '   ' })).toMatchObject({ success: false });
  });

  it('rethrows a cancelled call and any error after the caller aborts', async () => {
    const cancelled = new SandboxError('Cancelled', 'The sandbox call was cancelled.');
    mocks.withWorkspace.mockRejectedValueOnce(cancelled);

    await expect(call('runCommand', { command: 'sleep 30' })).rejects.toBe(cancelled);

    const controller = new AbortController();
    controller.abort();
    mocks.withWorkspace.mockRejectedValueOnce(new Error('The operation was aborted.'));
    await expect(
      invokeSandboxTool({
        apiName: 'runCommand',
        args: { command: 'sleep 30' },
        db: {} as any,
        sessionId: 'agent-1',
        signal: controller.signal,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('The operation was aborted.');

    mocks.withWorkspace.mockRejectedValueOnce(
      new SandboxError('Unavailable', 'OpenSandbox is down.'),
    );
    await expect(call('runCommand', { command: 'true' })).resolves.toEqual({
      error: 'OpenSandbox is down.',
      success: false,
    });
  });
});
