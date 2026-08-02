// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NewInstalledSkill, agents, userInstalledSkills, users } from '../../schemas';
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

  it('removes the skill from the owning user agents in the uninstall transaction', async () => {
    const otherUserId = 'skill-db-other';
    await serverDB.insert(users).values({ id: otherUserId });
    await serverDB.insert(agents).values([
      { id: 'skill-agent', skills: ['summarize-text', 'keep-skill'], userId },
      { id: 'other-skill-agent', skills: ['summarize-text'], userId: otherUserId },
    ]);
    await serverDB.insert(userInstalledSkills).values([
      {
        contentHash: 'hash-own',
        description: 'Summarize text.',
        identifier: 'summarize-text',
        instructions: 'Own instructions',
        name: 'summarize-text',
        sourceType: 'url',
        userId,
      },
      {
        contentHash: 'hash-other',
        description: 'Summarize text.',
        identifier: 'summarize-text',
        instructions: 'Other instructions',
        name: 'summarize-text',
        sourceType: 'url',
        userId: otherUserId,
      },
    ]);

    await skillModel.delete('summarize-text');

    const storedAgents = await serverDB.select().from(agents);
    expect(storedAgents.find(({ id }) => id === 'skill-agent')?.skills).toEqual(['keep-skill']);
    expect(storedAgents.find(({ id }) => id === 'other-skill-agent')?.skills).toEqual([
      'summarize-text',
    ]);
    expect(await skillModel.findById('summarize-text')).toBeUndefined();
    expect(await new SkillModel(serverDB, otherUserId).findById('summarize-text')).toBeDefined();
  });
});
