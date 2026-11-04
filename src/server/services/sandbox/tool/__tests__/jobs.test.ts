/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  countRunning: vi.fn(),
  create: vi.fn(),
  enqueue: vi.fn(),
  getResult: vi.fn(),
  keepsSessions: true,
  list: vi.fn(),
  profile: {} as Record<string, unknown>,
  withWorkspace: vi.fn(),
}));

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: {
    SANDBOX_JOB_MAX_RUNNING: 3,
    SANDBOX_MAX_FILE_BYTES: 64,
    SANDBOX_MAX_FILE_COUNT: 3,
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
vi.mock('../../profiles/catalog', () => ({
  resolveSandboxProfileForUser: async () => ({
    ok: true,
    profile: mocks.profile,
    server: { id: 'default', status: 'ok' },
  }),
}));
vi.mock('../../conversationFiles', () => ({
  listConversationSandboxInputs: async () => [],
  persistSandboxOutputFiles: async () => [],
}));
vi.mock('@/server/services/conversationGeneration/inboxSession', () => ({
  toPersistedConversationSessionId: (id?: string | null) => id ?? undefined,
}));
vi.mock('@/database/models/sandboxJob', () => ({
  SandboxJobModel: class {
    countRunning = mocks.countRunning;
    create = mocks.create;
  },
}));
vi.mock('../../profiles/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../profiles/files')>()),
  resolveSandboxFiles: async () => ({ items: [], mask: [] }),
}));
vi.mock('../../jobs/enqueue', () => ({ enqueueSandboxJobWatch: mocks.enqueue }));
vi.mock('../../jobs/service', () => ({
  cancelSandboxJob: mocks.cancel,
  getSandboxJobResult: mocks.getResult,
  listSandboxJobs: mocks.list,
}));

const { invokeSandboxTool } = await import('../index');
const { buildSandboxSessionKey } = await import('../../session');

const scope = { sessionId: 'agent-1', topicId: 'topic-1', userId: 'user-1' };
const call = (apiName: string, args: Record<string, unknown>) =>
  invokeSandboxTool({ apiName, args, db: {} as any, identifier: 'lobe-sandbox--data', ...scope });

const fakeWorkspace = () => ({
  exec: vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: '' })),
  interrupt: vi.fn(async () => undefined),
  startBackground: vi.fn(async () => 'cmd-7'),
  syncInputs: vi.fn(async () => undefined),
  workdir: '/tmp/workspace',
});
let workspace: ReturnType<typeof fakeWorkspace>;

const endedRow = {
  command: 'make',
  commandId: 'cmd-7',
  deadlineAt: new Date('2026-11-02T10:00:00Z'),
  error: 'Stopped with cancelJob.',
  exitCode: null,
  files: null,
  finishedAt: new Date('2026-11-02T08:30:00Z'),
  id: 'sjob_1',
  outputTail: 'partial\n',
  profileId: 'data',
  startedAt: new Date('2026-11-02T08:00:00Z'),
  status: 'cancelled',
};

describe('Sandbox job calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keepsSessions = true;
    mocks.profile = {
      id: 'data',
      jobMaxRuntimeMs: 7_200_000,
      name: 'Data',
      sessionIdleTimeoutMs: 1_800_000,
    };
    workspace = fakeWorkspace();
    mocks.withWorkspace.mockImplementation(async (_options, task) => task(workspace));
    mocks.countRunning.mockResolvedValue(0);
    mocks.create.mockImplementation(async (input: Record<string, any>) => ({
      ...input,
      id: 'sjob_1',
      status: 'running',
    }));
    mocks.enqueue.mockResolvedValue(undefined);
  });

  it('starts a job with its output folder, records it, and queues the watcher', async () => {
    const before = Date.now();
    const result = await call('startJob', {
      command: 'python train.py',
      cwd: 'project',
      maxRuntimeMinutes: '30',
      outputDir: "out/it's",
    });

    expect(workspace.exec).toHaveBeenCalledWith({
      command: "mkdir -p -- '/tmp/workspace/out/it'\\''s'",
      timeoutMs: 10_000,
    });
    expect(workspace.startBackground).toHaveBeenCalledWith({
      command: 'python train.py',
      cwd: '/tmp/workspace/project',
    });
    const created = mocks.create.mock.calls[0][0];
    expect(created).toMatchObject({
      command: 'python train.py',
      commandId: 'cmd-7',
      cwd: '/tmp/workspace/project',
      outputDir: "/tmp/workspace/out/it's",
      profileId: 'data',
      sessionKey: buildSandboxSessionKey({ ...scope, profileId: 'data' }),
    });
    const runtime = created.deadlineAt.getTime() - created.startedAt.getTime();
    expect(runtime).toBe(30 * 60_000);
    expect(created.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    const runAt = mocks.enqueue.mock.calls[0][2] as Date;
    expect(runAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(runAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(result).toMatchObject({ jobId: 'sjob_1', jobStatus: 'running', success: true });
    expect(result.hint).toContain('up to 30 minutes');
    expect(result.hint).toContain("Files written to /tmp/workspace/out/it's are kept");
  });

  it('caps the runtime at the profile limit', async () => {
    await call('startJob', { command: 'make', maxRuntimeMinutes: 100_000 });
    const created = mocks.create.mock.calls[0][0];
    expect(created.deadlineAt.getTime() - created.startedAt.getTime()).toBe(7_200_000);
    expect(workspace.exec).not.toHaveBeenCalled();
  });

  it('refuses jobs without persistent sandboxes, with jobs off, or over the running limit', async () => {
    mocks.keepsSessions = false;
    expect(await call('startJob', { command: 'make' })).toMatchObject({
      error: expect.stringContaining('idle timeout is 0'),
      success: false,
    });

    mocks.keepsSessions = true;
    mocks.profile.jobMaxRuntimeMs = 0;
    expect(await call('startJob', { command: 'make' })).toMatchObject({
      error: expect.stringContaining('turned off for this sandbox'),
      success: false,
    });

    mocks.profile.jobMaxRuntimeMs = 7_200_000;
    mocks.countRunning.mockResolvedValue(3);
    expect(await call('startJob', { command: 'make' })).toMatchObject({
      error: expect.stringContaining('3 background jobs are already running'),
      success: false,
    });
    expect(workspace.startBackground).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not start the command when the output folder cannot be made', async () => {
    workspace.exec.mockResolvedValue({ exitCode: 1, stderr: 'Permission denied\n', stdout: '' });
    expect(await call('startJob', { command: 'make', outputDir: '/root/out' })).toMatchObject({
      error: 'Could not create the output folder /root/out: Permission denied',
      success: false,
    });
    expect(workspace.startBackground).not.toHaveBeenCalled();
  });

  it('stops the command when its record cannot be saved', async () => {
    mocks.create.mockRejectedValue(new Error('database is down'));
    expect(await call('startJob', { command: 'make' })).toMatchObject({
      error: 'database is down',
      success: false,
    });
    expect(workspace.interrupt).toHaveBeenCalledWith('cmd-7');
  });

  it('warns that the job only lives for the idle timeout when no watcher can be queued', async () => {
    mocks.enqueue.mockRejectedValue(new Error('function graphile_worker.add_job does not exist'));
    const result = await call('startJob', { command: 'make' });
    expect(result.success).toBe(true);
    expect(result.hint).toContain('no job worker is running on this server');
    expect(result.hint).toContain('30 minutes');
  });

  it('reads, lists and cancels jobs through the job service', async () => {
    mocks.getResult.mockResolvedValue({ jobId: 'sjob_1', jobStatus: 'running', success: true });
    expect(await call('getJobResult', { jobId: 'sjob_1' })).toMatchObject({ jobId: 'sjob_1' });
    expect(mocks.getResult).toHaveBeenCalledWith({
      db: expect.anything(),
      jobId: 'sjob_1',
      userId: 'user-1',
    });
    mocks.getResult.mockResolvedValue(undefined);
    expect(await call('getJobResult', { jobId: 'sjob_x' })).toMatchObject({
      error: expect.stringContaining('Use listJobs'),
      success: false,
    });

    mocks.list.mockResolvedValue([]);
    expect(await call('listJobs', {})).toMatchObject({ jobs: [], success: true });
    expect(mocks.list).toHaveBeenCalledWith({
      db: expect.anything(),
      sessionKey: buildSandboxSessionKey({ ...scope, profileId: 'data' }),
      userId: 'user-1',
    });

    mocks.cancel.mockResolvedValue(endedRow);
    expect(await call('cancelJob', { jobId: 'sjob_1' })).toMatchObject({
      error: 'Stopped with cancelJob.',
      jobStatus: 'cancelled',
      log: 'partial\n',
      success: true,
    });
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'sjob_1', reason: 'Stopped with cancelJob.' }),
    );
    mocks.cancel.mockResolvedValue(undefined);
    expect(await call('cancelJob', { jobId: 'sjob_x' })).toMatchObject({ success: false });
  });

  it('checks job arguments', async () => {
    expect(await call('startJob', {})).toMatchObject({
      error: expect.stringContaining('Invalid arguments for startJob: command'),
    });
    expect(await call('getJobResult', { jobId: '' })).toMatchObject({ success: false });
    expect(mocks.withWorkspace).not.toHaveBeenCalled();
  });
});
