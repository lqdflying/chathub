// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxProfileModel } from '../sandboxProfile';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'sandbox-profile-user-a';
const userB = 'sandbox-profile-user-b';

describe('SandboxProfileModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  });

  it('stores explicit choices per user and profile, and updates them in place', async () => {
    const a = new SandboxProfileModel(serverDB, userA);
    const b = new SandboxProfileModel(serverDB, userB);

    expect(await a.list()).toEqual(new Map());
    expect(await a.find('data')).toBeUndefined();

    await a.setEnabled('data', true);
    await a.setEnabled('general', false);
    await a.setEnabled('data', false);
    await b.setEnabled('data', true);

    expect(await a.list()).toEqual(
      new Map([
        ['data', false],
        ['general', false],
      ]),
    );
    expect(await a.find('data')).toBe(false);
    expect(await b.find('data')).toBe(true);
  });

  it('removes a user’s choices with the user', async () => {
    await new SandboxProfileModel(serverDB, userA).setEnabled('data', true);
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userA });
    expect(await new SandboxProfileModel(serverDB, userA).list()).toEqual(new Map());
  });
});
