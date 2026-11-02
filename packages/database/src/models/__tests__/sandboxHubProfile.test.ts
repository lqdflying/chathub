// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { sandboxHubProfiles, sandboxProfileInstructions, userSandboxProfiles, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxHubProfileModel } from '../sandboxHubProfile';
import { SandboxProfileInstructionModel } from '../sandboxProfileInstruction';
import { SandboxProfileModel } from '../sandboxProfile';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const settings = (id: string, extra: Record<string, unknown> = {}) => ({
  description: `${id} profile`,
  id,
  name: id,
  serverId: 'default',
  ...extra,
});

describe('SandboxHubProfileModel', () => {
  beforeEach(async () => {
    await serverDB.delete(userSandboxProfiles);
    await serverDB.delete(sandboxProfileInstructions);
    await serverDB.delete(sandboxHubProfiles);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: 'admin-a' }, { id: 'user-b' }]);
  });

  it('seeds profiles once in the given order, even when seeded twice at once', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    const rows = [
      settings('general', { defaultEnabled: true }),
      settings('data', { egress: ['pypi.org'], jobMaxRuntimeMs: 21_600_000 }),
    ];
    const [first, second] = await Promise.all([model.seed(rows), model.seed(rows)]);
    expect(first + second).toBe(2);

    const listed = await model.list();
    expect(listed.map((row) => [row.id, row.position])).toEqual([
      ['general', 0],
      ['data', 1],
    ]);
    expect(listed[1]).toMatchObject({
      defaultEnabled: false,
      egress: ['pypi.org'],
      imageStatus: 'unknown',
      instructionBase: 'general',
      jobMaxRuntimeMs: 21_600_000,
    });
    expect(await model.count()).toBe(2);
  });

  it('adds profiles last, moves them, and stops at either end', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    await model.seed([settings('general'), settings('data')]);
    const created = await model.create(settings('web', { image: 'web:1' }), 'admin-a');
    expect(created).toMatchObject({ position: 2, updatedBy: 'admin-a' });

    expect(await model.move('web', 'up')).toBe(true);
    expect((await model.list()).map((row) => row.id)).toEqual(['general', 'web', 'data']);
    expect(await model.move('general', 'up')).toBe(false);
    expect(await model.move('data', 'down')).toBe(false);
    expect(await model.move('missing', 'up')).toBe(false);
  });

  it('clears the image status only when the image changes', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    await model.create(settings('data', { image: 'data:1' }), 'admin-a');
    await model.setImageStatus('data', { ref: 'data:1', status: 'ready' });
    expect(await model.find('data')).toMatchObject({
      imageCheckedRef: 'data:1',
      imageStatus: 'ready',
    });

    const renamed = await model.update(
      'data',
      settings('data', { image: 'data:1', name: 'Data' }),
      'user-b',
    );
    expect(renamed).toMatchObject({ imageStatus: 'ready', name: 'Data', updatedBy: 'user-b' });

    const moved = await model.update('data', settings('data', { image: 'data:2' }), 'admin-a');
    expect(moved).toMatchObject({ imageCheckedRef: null, imageStatus: 'unknown' });
    expect(await model.update('missing', settings('missing'), 'admin-a')).toBeUndefined();
  });

  it('deletes a profile, every user choice for it, and keeps rows when the editor is deleted', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    await model.create(settings('data'), 'admin-a');
    await model.create(settings('web'), 'admin-a');
    await new SandboxProfileModel(serverDB, 'admin-a').setEnabled('data', true);
    await new SandboxProfileModel(serverDB, 'user-b').setEnabled('data', false);
    await new SandboxProfileModel(serverDB, 'user-b').setEnabled('web', true);

    await model.deleteWithRelated('data');
    expect(await model.find('data')).toBeUndefined();
    expect([...(await new SandboxProfileModel(serverDB, 'user-b').list()).keys()]).toEqual(['web']);

    await serverDB.delete(userSandboxProfiles);
    await serverDB.delete(users);
    expect((await model.list()).map((row) => [row.id, row.updatedBy])).toEqual([['web', null]]);
  });

  it('drops an older prepare result after a newer run has started', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    await model.create(settings('data', { image: 'data:1' }), 'admin-a');
    const first = await model.setImageStatus('data', { ref: 'data:1', status: 'preparing' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await model.setImageStatus('data', { ref: 'data:1', status: 'preparing' });
    expect(first).toBeInstanceOf(Date);
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());

    expect(
      await model.setImageStatus(
        'data',
        { message: 'old', ref: 'data:1', status: 'failed' },
        first,
      ),
    ).toBeUndefined();
    expect(
      await model.setImageStatus(
        'data',
        { message: 'Ready after 3 s.', ref: 'data:1', status: 'ready' },
        new Date(second!.toISOString()),
      ),
    ).toBeInstanceOf(Date);
    expect(await model.find('data')).toMatchObject({
      imageStatus: 'ready',
      imageStatusMessage: 'Ready after 3 s.',
    });
    expect(
      await model.setImageStatus(
        'data',
        { message: 'late', ref: 'data:1', status: 'failed' },
        first,
      ),
    ).toBeUndefined();
    expect((await model.find('data'))?.imageStatus).toBe('ready');
  });

  it('deletes the profile, its instruction, and every user choice together', async () => {
    const model = new SandboxHubProfileModel(serverDB);
    await model.create(settings('data'), 'admin-a');
    await model.create(settings('web'), 'admin-a');
    await new SandboxProfileInstructionModel(serverDB).upsert('data', 'Edited.', 'admin-a');
    await new SandboxProfileInstructionModel(serverDB).upsert('web', 'Keep.', 'admin-a');
    await new SandboxProfileModel(serverDB, 'user-b').setEnabled('data', false);
    await new SandboxProfileModel(serverDB, 'user-b').setEnabled('web', true);

    await model.deleteWithRelated('data');

    expect(await model.find('data')).toBeUndefined();
    expect([...(await new SandboxProfileModel(serverDB, 'user-b').list()).keys()]).toEqual(['web']);
    expect([...(await new SandboxProfileInstructionModel(serverDB).list()).keys()]).toEqual(['web']);
    expect(await model.find('web')).toBeDefined();
  });
});
