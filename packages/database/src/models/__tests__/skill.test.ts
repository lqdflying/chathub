// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NewInstalledSkill, userInstalledSkills, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { SkillModel } from '../skill';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'skill-db';
const skillModel = new SkillModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SkillModel', () => {
  it('returns metadata without instructions from query and full content by id', async () => {
    const skill: NewInstalledSkill = {
      contentHash: 'hash-summarize',
      description: 'Summarize text.',
      identifier: 'summarize-text',
      instructions: 'Full instructions',
      name: 'summarize-text',
      sourceType: 'url',
      userId,
    };
    await serverDB.insert(userInstalledSkills).values(skill);

    const metadata = await skillModel.query();
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).not.toHaveProperty('instructions');

    const record = await skillModel.findById('summarize-text');
    expect(record?.instructions).toBe('Full instructions');
  });
});
