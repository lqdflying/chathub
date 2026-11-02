// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  checkedAt: new Date('2026-11-02T08:00:00.000Z'),
  executed: [] as unknown[],
  ignoreCheckedAt: undefined as Date | undefined,
  prepare: vi.fn(),
  row: undefined as Record<string, any> | undefined,
  server: { id: 'default', status: 'ok' } as Record<string, unknown> | undefined,
  statuses: [] as Array<Record<string, unknown>>,
}));

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
    state.executed.push(query);
  },
} as any;

const {
  SANDBOX_IMAGE_PREPARE_TIMEOUT_MS,
  effectiveImageStatus,
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
    state.executed = [];
    state.ignoreCheckedAt = undefined;
    state.row = row();
    state.server = { id: 'default', status: 'ok' };
    state.statuses = [];
    state.prepare.mockResolvedValue({ durationMs: 42_000 });
  });

  it('records a ready image for the image it prepared', async () => {
    await expect(
      prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt),
    ).resolves.toBe('ready');
    expect(state.prepare).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(state.statuses).toEqual([
      {
        expectedCheckedAt: '2026-11-02T08:00:00.000Z',
        id: 'data',
        message: 'Ready after 42 s.',
        ref: 'img.aksg.net/sandbox/python:1',
        status: 'ready',
      },
    ]);
  });

  it('prepares the inherited OPENSANDBOX_IMAGE when the profile sets none', async () => {
    state.row = row({ image: null });
    await prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt);
    expect(state.statuses[0]).toMatchObject({ ref: 'chathub-sandbox:2', status: 'ready' });
  });

  it('records why a preparation failed', async () => {
    state.prepare.mockRejectedValue(new Error('IMAGE_PULL_FAILED: manifest unknown'));
    await expect(
      prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt),
    ).resolves.toBe('failed');
    expect(state.statuses[0]).toMatchObject({
      message: 'IMAGE_PULL_FAILED: manifest unknown',
      status: 'failed',
    });

    state.server = { id: 'default', status: 'misconfigured' };
    await prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt);
    expect(state.statuses[1]).toMatchObject({
      message: 'Server "default" is missing its API key.',
      status: 'failed',
    });

    state.server = undefined;
    await prepareSandboxProfileImage(db, 'data', undefined, state.checkedAt);
    expect(state.statuses[2]).toMatchObject({
      message: 'Server "default" is not configured on this server.',
    });
    expect(
      await prepareSandboxProfileImage(db, 'missing', undefined, state.checkedAt),
    ).toBeUndefined();
  });

  it('records an aborted wait as the timeout message', async () => {
    state.prepare.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        }),
    );
    await prepareSandboxProfileImage(db, 'data', 50, state.checkedAt);
    expect(state.statuses[0]).toMatchObject({
      message: expect.stringMatching(/did not start within/),
      status: 'failed',
    });
  });

  it('prepares in this process and does not queue a worker job', async () => {
    await startSandboxImagePreparation(db, { id: 'data', image: null }, 'chathub-sandbox:2');
    expect(state.statuses[0]).toEqual({ id: 'data', ref: 'chathub-sandbox:2', status: 'preparing' });
    await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
    expect(state.executed).toHaveLength(0);
    expect(state.statuses.at(-1)).toMatchObject({
      expectedCheckedAt: '2026-11-02T08:00:00.000Z',
      status: 'ready',
    });
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
