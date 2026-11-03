// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { sandboxHubProfiles, sandboxProfileEnvs, userSandboxProfiles, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxHubProfileModel } from '../sandboxHubProfile';
import { SandboxProfileEnvModel } from '../sandboxProfileEnv';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const write = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  encryptedValue: `enc:${value}`,
  hint: null,
  name,
  profileId: 'data',
  updatedBy: 'admin',
  ...extra,
});

describe('SandboxProfileEnvModel', () => {
  beforeEach(async () => {
    await serverDB.delete(sandboxProfileEnvs);
    await serverDB.delete(userSandboxProfiles);
    await serverDB.delete(sandboxHubProfiles);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: 'admin' }, { id: 'user-a' }, { id: 'user-b' }]);
  });

  it('keeps one shared value and one value per user for each name', async () => {
    const model = new SandboxProfileEnvModel(serverDB);
    await model.upsertShared(write('TOKEN', 'shared-1'));
    await model.upsertShared(write('TOKEN', 'shared-2'));
    await model.upsertForUser('user-a', write('TOKEN', 'mine-a', { updatedBy: 'user-a' }));
    await model.upsertForUser('user-a', write('TOKEN', 'mine-a2', { updatedBy: 'user-a' }));
    await model.upsertForUser('user-b', write('TOKEN', 'mine-b', { updatedBy: 'user-b' }));

    expect(await model.count('data', { shared: true })).toBe(1);
    expect(await model.count('data', { userId: 'user-a' })).toBe(1);
    expect((await model.find('data', 'TOKEN', { shared: true }))?.value).toBe('enc:shared-2');
    expect((await model.find('data', 'TOKEN', { userId: 'user-a' }))?.value).toBe('enc:mine-a2');

    const forA = await model.listForSandbox('data', 'user-a');
    expect(forA.map((row) => [row.userId, row.value]).sort()).toEqual([
      [null, 'enc:shared-2'],
      ['user-a', 'enc:mine-a2'],
    ]);
    expect((await model.listVisible('user-b')).map((row) => row.value).sort()).toEqual([
      'enc:mine-b',
      'enc:shared-2',
    ]);
  });

  it('deletes by owner only', async () => {
    const model = new SandboxProfileEnvModel(serverDB);
    await model.upsertShared(write('TOKEN', 'shared'));
    await model.upsertForUser('user-a', write('TOKEN', 'mine'));

    expect(await model.delete('data', 'TOKEN', { userId: 'user-b' })).toBe(false);
    expect(await model.delete('data', 'TOKEN', { userId: 'user-a' })).toBe(true);
    expect(await model.count('data', { shared: true })).toBe(1);
    expect(await model.delete('data', 'TOKEN', { shared: true })).toBe(true);
    expect(await model.listVisible('user-a')).toEqual([]);
  });

  it('removes a user’s variables with the user and every variable with the profile', async () => {
    const env = new SandboxProfileEnvModel(serverDB);
    const profiles = new SandboxHubProfileModel(serverDB);
    await profiles.create(
      { description: 'd', id: 'data', name: 'Data', serverId: 'default' },
      'admin',
    );
    await env.upsertShared(write('TOKEN', 'shared'));
    await env.upsertForUser('user-a', write('MINE', 'a'));
    await env.upsertForUser('user-b', write('MINE', 'b', { profileId: 'other' }));

    await serverDB.delete(users).where(eq(users.id, 'user-a'));
    expect(await env.count('data', { userId: 'user-a' })).toBe(0);

    await profiles.deleteWithRelated('data');
    expect(await env.count('data', { shared: true })).toBe(0);
    expect(await env.count('other', { userId: 'user-b' })).toBe(1);
  });
});
