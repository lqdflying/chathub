// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { sandboxHubProfiles, sandboxProfileFiles, userSandboxProfiles, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxHubProfileModel } from '../sandboxHubProfile';
import { SandboxProfileFileModel } from '../sandboxProfileFile';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const write = (path: string, content: string, extra: Record<string, unknown> = {}) => ({
  encryptedContent: `enc:${content}`,
  mode: 600,
  path,
  profileId: 'data',
  sensitive: true,
  size: content.length,
  updatedBy: 'admin',
  ...extra,
});

describe('SandboxProfileFileModel', () => {
  beforeEach(async () => {
    await serverDB.delete(sandboxProfileFiles);
    await serverDB.delete(userSandboxProfiles);
    await serverDB.delete(sandboxHubProfiles);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: 'admin' }, { id: 'user-a' }, { id: 'user-b' }]);
  });

  it('keeps one shared file and one file per user for each path', async () => {
    const model = new SandboxProfileFileModel(serverDB);
    await model.upsertShared(write('/root/.oci/config', 'shared-1'));
    await model.upsertShared(write('/root/.oci/config', 'shared-2', { mode: 640 }));
    await model.upsertForUser(
      'user-a',
      write('/root/.oci/config', 'mine-a', { updatedBy: 'user-a' }),
    );
    await model.upsertForUser('user-a', write('/root/.oci/config', 'mine-a2'));
    await model.upsertForUser('user-b', write('/root/.oci/config', 'mine-b'));

    expect(await model.count('data', { shared: true })).toBe(1);
    expect(await model.count('data', { userId: 'user-a' })).toBe(1);
    expect(await model.find('data', '/root/.oci/config', { shared: true })).toMatchObject({
      content: 'enc:shared-2',
      mode: 640,
      size: 8,
    });

    const forA = await model.listForSandbox('data', 'user-a');
    expect(forA.map((row) => [row.userId, row.content]).sort()).toEqual([
      [null, 'enc:shared-2'],
      ['user-a', 'enc:mine-a2'],
    ]);
    expect((await model.listVisible('user-b')).map((row) => row.content).sort()).toEqual([
      'enc:mine-b',
      'enc:shared-2',
    ]);
  });

  it('changes mode and Sensitive without touching the content', async () => {
    const model = new SandboxProfileFileModel(serverDB);
    await model.upsertForUser('user-a', write('/etc/pip.conf', 'index'));

    expect(
      await model.updateSettings(
        'data',
        '/etc/pip.conf',
        { userId: 'user-b' },
        {
          mode: 644,
          sensitive: false,
          updatedBy: 'user-b',
        },
      ),
    ).toBe(false);
    expect(
      await model.updateSettings(
        'data',
        '/etc/pip.conf',
        { userId: 'user-a' },
        {
          mode: 644,
          sensitive: false,
          updatedBy: 'user-a',
        },
      ),
    ).toBe(true);
    expect(await model.find('data', '/etc/pip.conf', { userId: 'user-a' })).toMatchObject({
      content: 'enc:index',
      mode: 644,
      sensitive: false,
    });
  });

  it('deletes by owner, with the user, and with the profile', async () => {
    const files = new SandboxProfileFileModel(serverDB);
    const profiles = new SandboxHubProfileModel(serverDB);
    await profiles.create(
      { description: 'd', id: 'data', name: 'Data', serverId: 'default' },
      'admin',
    );
    await files.upsertShared(write('/root/.netrc', 'shared'));
    await files.upsertForUser('user-a', write('/root/.netrc', 'mine'));
    await files.upsertForUser('user-b', write('/root/.netrc', 'b', { profileId: 'other' }));

    expect(await files.delete('data', '/root/.netrc', { userId: 'user-b' })).toBe(false);
    await serverDB.delete(users).where(eq(users.id, 'user-a'));
    expect(await files.count('data', { userId: 'user-a' })).toBe(0);

    await profiles.deleteWithRelated('data');
    expect(await files.count('data', { shared: true })).toBe(0);
    expect(await files.count('other', { userId: 'user-b' })).toBe(1);
  });
});
