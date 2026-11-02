// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SandboxError, SandboxRequestError } from '../../types';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  enqueue: vi.fn(),
  gate: undefined as any,
  persist: vi.fn(),
  profileExists: true,
  providerError: undefined as unknown,
  rows: new Map<string, any>(),
  withWorkspace: vi.fn(),
  workspace: undefined as any,
}));

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: { SANDBOX_MAX_FILE_BYTES: 1000, SANDBOX_MAX_FILE_COUNT: 2 },
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/sandboxJob', () => ({
  SandboxJobModel: class {
    constructor(
      _db: unknown,
      private userId: string,
    ) {}
    find = async (id: string) => {
      const row = state.rows.get(id);
      return row && row.userId === this.userId ? { ...row } : undefined;
    };
    finish = async (id: string, input: Row) => {
      const row = state.rows.get(id);
      if (!row || row.userId !== this.userId || row.status !== 'running') return undefined;
      const next = {
        ...row,
        error: input.error ?? null,
        exitCode: input.exitCode ?? null,
        files: input.files ?? null,
        finishedAt: new Date('2026-11-02T10:30:00Z'),
        outputTail: input.outputTail ?? null,
        status: input.status,
      };
      state.rows.set(id, next);
      return { ...next };
    };
    listBySession = async (sessionKey: string) =>
      [...state.rows.values()].filter((row) => row.sessionKey === sessionKey);
    listRecent = async () => [...state.rows.values()];
    markChecked = async (id: string, at: Date) => {
      const row = state.rows.get(id);
      if (row?.status === 'running') row.lastCheckedAt = at;
    };
  },
}));
vi.mock('../../profiles/catalog', () => ({
  resolveSandboxProfileForUser: async () => state.gate,
}));
vi.mock('../../profiles/load', () => ({
  findSandboxProfile: (id: string) =>
    state.profileExists ? { id, serverId: 'default' } : undefined,
  findSandboxServer: (id: string) => ({ id, status: 'ok' }),
}));
vi.mock('../../registry', () => ({
  getSandboxProvider: () => ({
    withWorkspace: async (options: unknown, task: (workspace: unknown) => Promise<unknown>) => {
      state.withWorkspace(options);
      if (state.providerError) throw state.providerError;
      return task(state.workspace);
    },
  }),
}));
vi.mock('../../conversationFiles', () => ({ persistSandboxOutputFiles: state.persist }));
vi.mock('../enqueue', () => ({ enqueueSandboxJobWatch: state.enqueue }));

const { SANDBOX_GONE_MESSAGE, checkSandboxJob, summarizeCommand } = await import('../lifecycle');
const { cancelSandboxJob, getSandboxJobResult, listSandboxJobs, watchSandboxJob } =
  await import('../service');
const { handleSandboxJobWatch } = await import('../watcher');

const db = {} as never;
const START = new Date('2026-11-02T08:00:00Z');
const DEADLINE = new Date('2026-11-02T10:00:00Z');
const BEFORE_DEADLINE = new Date('2026-11-02T09:00:00Z').getTime();

const addJob = (extra: Row = {}) => {
  const row = {
    command: 'python train.py\necho done',
    commandId: 'cmd-1',
    cwd: null,
    deadlineAt: DEADLINE,
    error: null,
    exitCode: null,
    files: null,
    finishedAt: null,
    id: 'sjob_1',
    lastCheckedAt: null,
    outputDir: '/tmp/workspace/out',
    outputTail: null,
    profileId: 'data',
    sessionKey: 'session-1',
    startedAt: START,
    status: 'running',
    userId: 'user-1',
    ...extra,
  };
  state.rows.set(row.id, row);
  return { ...row } as any;
};

const fakeWorkspace = (status: { exitCode?: number; error?: string; running: boolean }) => ({
  commandLogs: vi.fn(async () => ({ cursor: 10, output: 'epoch 3/3\n' })),
  commandStatus: vi.fn(async () => status),
  interrupt: vi.fn(async () => undefined),
  listDirectory: vi.fn(async () => [
    { path: '/tmp/workspace/out/b.csv', size: 4, type: 'file' },
    { path: '/tmp/workspace/out/a.png', size: 4, type: 'file' },
    { path: '/tmp/workspace/out/nested', size: 0, type: 'directory' },
    { path: '/tmp/workspace/out/nested/c.txt', size: 4, type: 'file' },
  ]),
  markSynced: vi.fn(async () => undefined),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  workdir: '/tmp/workspace',
});

const ok = { ok: true, profile: { id: 'data' }, server: { id: 'default' } };

describe('Sandbox background jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = new Map();
    state.gate = ok;
    state.profileExists = true;
    state.providerError = undefined;
    state.workspace = fakeWorkspace({ running: true });
    state.persist.mockImplementation(async ({ files }: { files: { filename: string }[] }) =>
      files.map((file, index) => ({
        fileId: `file_${index}`,
        filename: file.filename,
        url: `/f/${file.filename}`,
      })),
    );
  });

  it('summarizes multi-line and long commands', () => {
    expect(summarizeCommand('python train.py\necho done')).toBe('python train.py …');
    expect(summarizeCommand('x'.repeat(300))).toHaveLength(200);
  });

  it('checks a running job in its own sandbox without creating one, and records the check', async () => {
    const row = addJob();
    const { log, row: checked } = await checkSandboxJob({
      apiName: 'getJobResult',
      db,
      now: BEFORE_DEADLINE,
      row,
      userId: 'user-1',
      withLog: true,
    });
    expect(state.withWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ createIfMissing: false, sessionKey: 'session-1' }),
    );
    expect(checked.status).toBe('running');
    expect(log).toBe('epoch 3/3\n');
    expect(state.rows.get('sjob_1').lastCheckedAt).toEqual(new Date(BEFORE_DEADLINE));
    expect(state.workspace.interrupt).not.toHaveBeenCalled();
  });

  it('saves the output and the output folder files when the command succeeds', async () => {
    state.workspace = fakeWorkspace({ exitCode: 0, running: false });
    const { row } = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: BEFORE_DEADLINE,
      row: addJob(),
      userId: 'user-1',
    });

    expect(row).toMatchObject({ exitCode: 0, outputTail: 'epoch 3/3\n', status: 'succeeded' });
    // Sorted paths, cut to the 2-file limit; the rest is noted.
    expect(row.files.map((file: { filename: string }) => file.filename)).toEqual([
      'a.png',
      'b.csv',
    ]);
    expect(row.error).toBe('Not kept: 1 more file(s) over the 2-file limit');
    expect(state.workspace.markSynced).toHaveBeenCalledWith(['file_0', 'file_1']);
  });

  it('records a non-zero exit as failed', async () => {
    state.workspace = fakeWorkspace({ exitCode: 2, running: false });
    const { row } = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: BEFORE_DEADLINE,
      row: addJob({ outputDir: null }),
      userId: 'user-1',
    });
    expect(row).toMatchObject({
      error: 'The command exited with code 2.',
      exitCode: 2,
      status: 'failed',
    });
    expect(state.persist).not.toHaveBeenCalled();
  });

  it('stops a job at its deadline and keeps what it produced', async () => {
    const { row } = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: DEADLINE.getTime(),
      row: addJob(),
      userId: 'user-1',
    });
    expect(state.workspace.interrupt).toHaveBeenCalledWith('cmd-1');
    expect(row).toMatchObject({ status: 'timed_out' });
    expect(row.error).toContain('Stopped at its 120-minute runtime limit.');
    expect(row.files).toHaveLength(2);
  });

  it('stops a job whose profile was turned off, but not on other gate failures', async () => {
    state.gate = {
      message: 'The "data" sandbox is turned off in Sandbox Hub.',
      ok: false,
      reason: 'disabled',
    };
    const { row } = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: BEFORE_DEADLINE,
      row: addJob(),
      userId: 'user-1',
    });
    expect(row.status).toBe('cancelled');
    expect(row.error).toContain('turned off in Sandbox Hub');

    state.gate = {
      message: 'Sandbox Hub choices could not be read.',
      ok: false,
      reason: 'not_configured',
    };
    const second = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: BEFORE_DEADLINE,
      row: addJob({ id: 'sjob_2' }),
      userId: 'user-1',
    });
    expect(second.row.status).toBe('running');
  });

  it('marks a job lost when its sandbox or command is gone, or its profile was removed', async () => {
    state.providerError = new SandboxError('NotFound', 'no sandbox');
    const gone = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      row: addJob(),
      userId: 'user-1',
    });
    expect(gone.row).toMatchObject({ error: SANDBOX_GONE_MESSAGE, status: 'lost' });

    state.providerError = undefined;
    state.workspace.commandStatus.mockRejectedValue(new SandboxRequestError('unknown command'));
    const unknown = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      row: addJob({ id: 'sjob_2' }),
      userId: 'user-1',
    });
    expect(unknown.row.status).toBe('lost');

    state.gate = {
      message: 'The "data" sandbox is not configured.',
      ok: false,
      reason: 'not_configured',
    };
    state.profileExists = false;
    const removed = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      row: addJob({ id: 'sjob_3' }),
      userId: 'user-1',
    });
    expect(removed.row).toMatchObject({
      error: 'The "data" sandbox is not configured.',
      status: 'lost',
    });
  });

  it('finishes the job even when its files cannot be stored', async () => {
    state.workspace = fakeWorkspace({ exitCode: 0, running: false });
    state.persist.mockRejectedValue(new Error('S3 down'));
    const { row } = await checkSandboxJob({
      apiName: 'watchJob',
      db,
      now: BEFORE_DEADLINE,
      row: addJob(),
      userId: 'user-1',
    });
    expect(row.status).toBe('succeeded');
    expect(row.files).toEqual([]);
    expect(row.error).toContain('the files could not be stored');
  });

  it('retries an unreachable server and gives the job up after 10 minutes without contact', async () => {
    state.providerError = new SandboxError('Unavailable', 'unreachable');
    const row = addJob({ lastCheckedAt: new Date(BEFORE_DEADLINE - 5 * 60_000) });
    expect(
      (await watchSandboxJob({ db, now: BEFORE_DEADLINE, row, userId: 'user-1' })).status,
    ).toBe('running');
    const late = await watchSandboxJob({
      db,
      now: BEFORE_DEADLINE + 6 * 60_000,
      row,
      userId: 'user-1',
    });
    expect(late).toMatchObject({ status: 'lost' });
    expect(late.error).toContain('could not be reached for 10 minutes');
  });

  it('returns a saved result without touching the sandbox, and a live one while running', async () => {
    addJob({
      exitCode: 0,
      files: [{ fileId: 'file_9', filename: 'model.bin', url: '/f/model.bin' }],
      finishedAt: new Date('2026-11-02T08:45:00Z'),
      outputTail: 'done\n',
      status: 'succeeded',
    });
    const saved = await getSandboxJobResult({ db, jobId: 'sjob_1', userId: 'user-1' });
    expect(saved).toMatchObject({
      durationMs: 45 * 60_000,
      exitCode: 0,
      files: [{ filename: 'model.bin', url: '/f/model.bin' }],
      jobStatus: 'succeeded',
      log: 'done\n',
      running: false,
      success: true,
    });
    expect(state.withWorkspace).not.toHaveBeenCalled();

    // A deadline after the real clock, which getSandboxJobResult uses.
    addJob({ deadlineAt: new Date(Date.now() + 3_600_000), id: 'sjob_2' });
    const live = await getSandboxJobResult({ db, jobId: 'sjob_2', userId: 'user-1' });
    expect(live).toMatchObject({
      jobStatus: 'running',
      log: 'epoch 3/3\n',
      running: true,
      success: true,
    });

    expect(await getSandboxJobResult({ db, jobId: 'sjob_1', userId: 'user-2' })).toBeUndefined();
  });

  it('cancels a running job once and leaves an ended job alone', async () => {
    addJob({ outputDir: null });
    const cancelled = await cancelSandboxJob({
      db,
      jobId: 'sjob_1',
      reason: 'Cancelled from Sandbox Hub.',
      userId: 'user-1',
    });
    expect(cancelled).toMatchObject({ error: 'Cancelled from Sandbox Hub.', status: 'cancelled' });
    expect(state.workspace.interrupt).toHaveBeenCalledTimes(1);

    const again = await cancelSandboxJob({ db, jobId: 'sjob_1', reason: 'x', userId: 'user-1' });
    expect(again?.status).toBe('cancelled');
    expect(state.workspace.interrupt).toHaveBeenCalledTimes(1);
  });

  it('lists jobs per conversation or per user as summaries', async () => {
    addJob();
    addJob({ id: 'sjob_2', sessionKey: 'session-2' });
    expect(
      (await listSandboxJobs({ db, sessionKey: 'session-1', userId: 'user-1' })).map(
        (job) => job.id,
      ),
    ).toEqual(['sjob_1']);
    const [first] = await listSandboxJobs({ db, userId: 'user-1' });
    expect(first).toEqual({
      command: 'python train.py …',
      id: 'sjob_1',
      profileId: 'data',
      startedAt: START.toISOString(),
      status: 'running',
    });
  });

  it('queues the next watch only while the job runs', async () => {
    addJob({ deadlineAt: new Date(Date.now() + 3_600_000) });
    await handleSandboxJobWatch({ jobId: 'sjob_1', userId: 'user-1' }, {} as never);
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      { jobId: 'sjob_1', userId: 'user-1' },
      expect.any(Date),
    );

    state.enqueue.mockClear();
    state.workspace = fakeWorkspace({ exitCode: 0, running: false });
    await handleSandboxJobWatch({ jobId: 'sjob_1', userId: 'user-1' }, {} as never);
    expect(state.rows.get('sjob_1').status).toBe('succeeded');
    expect(state.enqueue).not.toHaveBeenCalled();

    await handleSandboxJobWatch({ jobId: 'sjob_1', userId: 'user-1' }, {} as never);
    await handleSandboxJobWatch({ nope: true }, {} as never);
    expect(state.withWorkspace).toHaveBeenCalledTimes(2);
  });
});
