// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  checkedAt: new Date('2026-11-02T08:00:00.000Z'),
  enqueueError: undefined as unknown,
  executed: [] as unknown[],
  ignoreCheckedAt: undefined as Date | undefined,
  prepare: vi.fn(),
  row: undefined as Record<string, any> | undefined,
  server: { id: 'default', status: 'ok' } as Record<string, unknown> | undefined,
  statuses: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/sandboxHubProfile', () => ({
  SandboxHubProfileModel: class {
    find = async (id: string) => (state.row?.id === id ? state.row : undefined);
    setImageStatus = async (
      id: string,
      status: Record<string, unknown>,
      expectedCheckedAt?: Date,
    ) => {
      if (expectedCheckedAt && state.ignoreCheckedAt?.getTime() === expectedCheckedAt.getTime()) {
        return undefined;
      }
      state.statuses.push({
        id,
        ...status,
        ...(expectedCheckedAt ? { expectedCheckedAt: expectedCheckedAt.toISOString() } : {}),
      });
      return state.checkedAt;
    };
  },
}));
vi.mock('../load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  findSandboxServer: () => state.server,
  readSandboxProfilesEnv: () => ({
    OPENSANDBOX_CPU: '1',
    OPENSANDBOX_IMAGE: 'chathub-sandbox:2',
    OPENSANDBOX_MEMORY: '2Gi',
    OPENSANDBOX_READY_TIMEOUT: 60_000,
    OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
    OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
  }),
}));
vi.mock('../../registry', () => ({
  getSandboxProvider: () => ({ prepareImage: state.prepare }),
}));

const db = {
  execute: async (query: unknown) => {
    if (state.enqueueError) throw state.enqueueError;
    state.executed.push(query);
  },
} as any;

const {
  SANDBOX_IMAGE_PREPARE_TIMEOUT_MS,
  effectiveImageStatus,
  handleSandboxImagePrepare,
  prepareSandboxProfileImage,
  startSandboxImagePreparation,
} = await import('../prepare');

const row = (extra: Record<string, unknown> = {}) => ({
  avatar: null,
  cpu: null,
  defaultEnabled: false,
  description: 'Data profile',
  egress: null,
  id: 'data',
  image: 'img.aksg.net/sandbox/python:1',
  instructionBase: 'general',
  instructionText: null,
  jobMaxRuntimeMs: null,
  memory: null,
  name: 'Data',
  readyTimeoutMs: null,
  serverId: 'default',
  sessionIdleTimeoutMs: null,
  sessionMaxLifetimeMs: null,
  ...extra,
});

describe('Prepare image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.enqueueError = undefined;
    state.executed = [];
    state.ignoreCheckedAt = undefined;
    state.row = row();
    state.server = { id: 'default', status: 'ok' };
    state.statuses = [];
    state.prepare.mockResolvedValue({ durationMs: 42_000 });
  });

  it('records a ready image for the image it prepared', async () => {
    await expect(prepareSandboxProfileImage(db, 'data')).resolves.toBe('ready');
    expect(state.prepare).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(state.statuses).toEqual([
      {
        id: 'data',
        message: 'Ready after 42 s.',
        ref: 'img.aksg.net/sandbox/python:1',
        status: 'ready',
      },
    ]);
  });

  it('prepares the inherited OPENSANDBOX_IMAGE when the profile sets none', async () => {
    state.row = row({ image: null });
    await prepareSandboxProfileImage(db, 'data');
    expect(state.statuses[0]).toMatchObject({ ref: 'chathub-sandbox:2', status: 'ready' });
  });

  it('records why a preparation failed', async () => {
    state.prepare.mockRejectedValue(new Error('IMAGE_PULL_FAILED: manifest unknown'));
    await expect(prepareSandboxProfileImage(db, 'data')).resolves.toBe('failed');
    expect(state.statuses[0]).toMatchObject({
      message: 'IMAGE_PULL_FAILED: manifest unknown',
      status: 'failed',
    });

    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    state.prepare.mockRejectedValue(timeout);
    await prepareSandboxProfileImage(db, 'data', 2 * 60_000);
    expect(state.statuses[1]).toMatchObject({
      message: 'The image did not start within 2 minutes.',
      status: 'failed',
    });

    state.server = { id: 'default', status: 'misconfigured' };
    await prepareSandboxProfileImage(db, 'data');
    expect(state.statuses[2]).toMatchObject({
      message: 'Server "default" is missing its API key.',
      status: 'failed',
    });

    state.server = undefined;
    await prepareSandboxProfileImage(db, 'data');
    expect(state.statuses[3]).toMatchObject({
      message: 'Server "default" is not configured on this server.',
    });
    expect(await prepareSandboxProfileImage(db, 'missing')).toBeUndefined();
  });

  it('marks the profile as preparing and queues the work, or runs it here', async () => {
    await startSandboxImagePreparation(db, { id: 'data', image: null }, 'chathub-sandbox:2');
    expect(state.statuses).toEqual([{ id: 'data', ref: 'chathub-sandbox:2', status: 'preparing' }]);
    expect(state.executed).toHaveLength(1);
    expect(JSON.stringify(state.executed[0])).toContain(
      '\\"checkedAt\\":\\"2026-11-02T08:00:00.000Z\\",\\"profileId\\":\\"data\\"',
    );
    expect(state.prepare).not.toHaveBeenCalled();

    state.enqueueError = new Error('function graphile_worker.add_job does not exist');
    await startSandboxImagePreparation(db, { id: 'data', image: null }, 'chathub-sandbox:2');
    await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
    expect(state.statuses.at(-1)).toMatchObject({
      expectedCheckedAt: '2026-11-02T08:00:00.000Z',
      status: 'ready',
    });
  });

  it('runs here when the conversation worker is disabled, and does not queue', async () => {
    process.env.DISABLE_CONVERSATION_WORKER = '1';
    try {
      await startSandboxImagePreparation(db, { id: 'data', image: null }, 'chathub-sandbox:2');
      await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
      expect(state.executed).toHaveLength(0);
    } finally {
      delete process.env.DISABLE_CONVERSATION_WORKER;
    }
  });

  it('runs the queued task for a profile id only', async () => {
    await handleSandboxImagePrepare(
      { checkedAt: '2026-11-02T08:00:00.000Z', profileId: 'data' },
      {} as never,
    );
    await handleSandboxImagePrepare({}, {} as never);
    await handleSandboxImagePrepare({ checkedAt: 'not-a-time', profileId: 'data' }, {} as never);
    expect(state.prepare).toHaveBeenCalledTimes(1);
    expect(state.statuses[0]).toMatchObject({ expectedCheckedAt: '2026-11-02T08:00:00.000Z' });
  });

  it('drops a result when a newer preparation has replaced this run', async () => {
    state.ignoreCheckedAt = state.checkedAt;
    await expect(
      prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt),
    ).resolves.toBeUndefined();
    expect(state.statuses).toEqual([]);
  });

  it('shows a status only for the current image, and a stuck preparation as failed', () => {
    const checkedAt = new Date('2026-11-02T08:00:00Z');
    const base = {
      imageCheckedAt: checkedAt,
      imageCheckedRef: 'img:1',
      imageStatus: 'ready' as const,
      imageStatusMessage: 'Ready after 3 s.',
    };
    expect(effectiveImageStatus(base, 'img:1', checkedAt.getTime())).toEqual({
      message: 'Ready after 3 s.',
      status: 'ready',
      updatedAt: checkedAt.toISOString(),
    });
    expect(effectiveImageStatus(base, 'img:2')).toEqual({ status: 'unknown' });

    const preparing = { ...base, imageStatus: 'preparing' as const, imageStatusMessage: null };
    expect(effectiveImageStatus(preparing, 'img:1', checkedAt.getTime() + 60_000).status).toBe(
      'preparing',
    );
    expect(
      effectiveImageStatus(
        preparing,
        'img:1',
        checkedAt.getTime() + SANDBOX_IMAGE_PREPARE_TIMEOUT_MS + 6 * 60_000,
      ),
    ).toMatchObject({ message: 'The preparation did not finish.', status: 'failed' });
  });
});
