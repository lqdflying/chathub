import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillModel } from '@/database/models/skill';

import { ClientSkillService } from './client';
import { DUPLICATE_SKILL_CONTENT_MESSAGE } from './errors';

const model = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/client/db', () => ({ clientDB: {} }));
vi.mock('@/database/models/skill');

const skillDocument = `---
name: summarize-text
description: Summarize a document.
---

Summarize the supplied document.
`;

describe('ClientSkillService', () => {
  const service = new ClientSkillService('account-a');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SkillModel).mockImplementation(() => model as never);
    model.create.mockResolvedValue(undefined);
    model.update.mockResolvedValue({ identifier: 'summarize-text' });
  });

  it('maps duplicate content during install to a user-facing error', async () => {
    model.create.mockRejectedValueOnce({
      code: '23505',
      constraint: 'user_installed_skills_user_hash_unique',
    });

    await expect(
      service.installSkill({ instructions: skillDocument, sourceType: 'file' }),
    ).rejects.toThrow(DUPLICATE_SKILL_CONTENT_MESSAGE);
  });

  it('maps nested duplicate content errors during edit to the same user-facing error', async () => {
    model.update.mockRejectedValueOnce({
      cause: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint user_installed_skills_user_hash_unique',
      },
    });

    await expect(
      service.updateSkill({
        description: 'Updated description.',
        identifier: 'summarize-text',
        instructions: 'Updated instructions.',
      }),
    ).rejects.toThrow(DUPLICATE_SKILL_CONTENT_MESSAGE);
  });
});
