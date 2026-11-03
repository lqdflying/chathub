// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { sandboxJobs, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxJobModel } from '../sandboxJob';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const job = (sessionKey: string, startedAt: Date) => ({
  command: 'python train.py',
  commandId: `cmd-${startedAt.getTime()}`,
  deadlineAt: new Date(startedAt.getTime() + 7_200_000),
  outputDir: 'out',
  profileId: 'general',
  sessionKey,
  startedAt,
});

describe('SandboxJobModel', () => {
  beforeEach(async () => {
    await serverDB.delete(sandboxJobs);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: 'user-a' }, { id: 'user-b' }]);
  });

  it('creates running jobs and lists them per conversation and per user, newest first', async () => {
    const model = new SandboxJobModel(serverDB, 'user-a');
    const first = await model.create(job('conv-1', new Date(Date.now() + 60_000)));
    const second = await model.create(job('conv-1', new Date(Date.now() + 120_000)));
    const other = await model.create(job('conv-2', new Date(Date.now() + 180_000)));

    expect(first.id).toMatch(/^sjob_/);
    expect(first).toMatchObject({ status: 'running', userId: 'user-a' });
    expect((await model.listBySession('conv-1')).map((row) => row.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect((await model.listRecent()).map((row) => row.id)).toEqual([
      other.id,
      second.id,
      first.id,
    ]);
    expect(await model.countRunning()).toBe(3);

    await model.create(job('conv-1', new Date('2026-11-01T08:00:00Z')));
    expect(await model.countRunning()).toBe(3);
  });

  it('keeps users apart', async () => {
    const created = await new SandboxJobModel(serverDB, 'user-a').create(job('conv-1', new Date()));
    const otherUser = new SandboxJobModel(serverDB, 'user-b');

    expect(await otherUser.find(created.id)).toBeUndefined();
    expect(await otherUser.listRecent()).toEqual([]);
    expect(await otherUser.countRunning()).toBe(0);
    expect(await otherUser.finish(created.id, { status: 'cancelled' })).toBeUndefined();
    expect((await new SandboxJobModel(serverDB, 'user-a').find(created.id))?.status).toBe(
      'running',
    );
  });

  it('finishes a job once and ignores later endings and checks', async () => {
    const model = new SandboxJobModel(serverDB, 'user-a');
    const created = await model.create(job('conv-1', new Date()));
    const checkedAt = new Date('2026-11-01T08:05:00Z');
    await model.markChecked(created.id, checkedAt);

    const finished = await model.finish(created.id, {
      exitCode: 0,
      files: [{ fileId: 'file_1', filename: 'result.txt', url: '/f/1' }],
      outputTail: 'done\n',
      status: 'succeeded',
    });
    expect(finished).toMatchObject({
      exitCode: 0,
      files: [{ fileId: 'file_1', filename: 'result.txt', url: '/f/1' }],
      lastCheckedAt: checkedAt,
      outputTail: 'done\n',
      status: 'succeeded',
    });
    expect(finished?.finishedAt).toBeInstanceOf(Date);

    expect(await model.finish(created.id, { status: 'cancelled' })).toBeUndefined();
    await model.markChecked(created.id, new Date('2026-11-01T09:00:00Z'));
    expect(await model.find(created.id)).toMatchObject({
      lastCheckedAt: checkedAt,
      status: 'succeeded',
    });
    expect(await model.countRunning()).toBe(0);
  });

  it('pages succeeded jobs and deletes only those', async () => {
    const model = new SandboxJobModel(serverDB, 'user-a');
    const running = await model.create(job('conv-1', new Date('2026-11-03T01:00:00Z')));
    const older = await model.create(job('conv-1', new Date('2026-11-03T02:00:00Z')));
    const newer = await model.create(job('conv-1', new Date('2026-11-03T03:00:00Z')));
    const failed = await model.create(job('conv-1', new Date('2026-11-03T04:00:00Z')));
    await model.finish(older.id, { status: 'succeeded' });
    await model.finish(newer.id, { status: 'succeeded' });
    await model.finish(failed.id, { status: 'failed' });
    const kept = await new SandboxJobModel(serverDB, 'user-b').create(
      job('conv-1', new Date('2026-11-03T05:00:00Z')),
    );
    await new SandboxJobModel(serverDB, 'user-b').finish(kept.id, { status: 'succeeded' });

    expect((await model.listOther()).map((row) => row.id)).toEqual([failed.id, running.id]);
    expect(await model.countSucceeded()).toBe(2);
    expect((await model.listSucceeded(1, 1)).map((row) => row.id)).toEqual([older.id]);
    expect(await model.deleteSucceeded()).toBe(2);
    expect(await model.countSucceeded()).toBe(0);
    expect((await model.find(running.id))?.status).toBe('running');
    expect((await model.find(failed.id))?.status).toBe('failed');
    expect((await new SandboxJobModel(serverDB, 'user-b').find(kept.id))?.status).toBe('succeeded');
  });

  it('removes jobs with their user', async () => {
    await new SandboxJobModel(serverDB, 'user-a').create(job('conv-1', new Date()));
    await serverDB.delete(users);
    expect(await serverDB.select().from(sandboxJobs)).toEqual([]);
  });
});
