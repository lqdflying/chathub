// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { sandboxProfileInstructions, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SandboxProfileInstructionModel } from '../sandboxProfileInstruction';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

describe('SandboxProfileInstructionModel', () => {
  beforeEach(async () => {
    await serverDB.delete(sandboxProfileInstructions);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: 'admin-a' }, { id: 'admin-b' }]);
  });

  it('stores one shared instruction per profile and replaces it on edit', async () => {
    const model = new SandboxProfileInstructionModel(serverDB);
    expect(await model.list()).toEqual(new Map());

    await model.upsert('general', 'first text', 'admin-a');
    await model.upsert('data', 'data text', 'admin-a');
    await model.upsert('general', 'second text', 'admin-b');

    const saved = await model.list();
    expect([...saved.keys()].sort()).toEqual(['data', 'general']);
    expect(saved.get('general')?.instruction).toBe('second text');
    expect(saved.get('general')?.updatedAt).toBeInstanceOf(Date);
  });

  it('removes an instruction on reset and keeps it when its editor is deleted', async () => {
    const model = new SandboxProfileInstructionModel(serverDB);
    await model.upsert('general', 'text', 'admin-a');
    await model.upsert('data', 'data text', 'admin-b');

    await model.delete('general');
    await serverDB.delete(users);

    expect([...(await model.list()).keys()]).toEqual(['data']);
  });
});
