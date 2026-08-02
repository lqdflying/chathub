import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { SkillModel } from '@/database/models/skill';
import { MAX_SKILL_BYTES } from '@/services/skill/parser';

import { skillRouter } from '../skill';

const ssrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/skill');

vi.mock('ssrf-safe-fetch', () => ({ ssrfSafeFetch }));

const skillDocument = `---
name: summarize-text
description: Summarize a document.
---

Summarize the supplied document.
`;

describe('skillRouter', () => {
  const create = vi.fn();

  const createCaller = () =>
    skillRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(SkillModel).mockImplementation(
      () =>
        ({
          create,
          delete: vi.fn(),
          findById: vi.fn(),
          query: vi.fn(),
        }) as never,
    );
    create.mockResolvedValue(undefined);
    ssrfSafeFetch.mockResolvedValue(new Response(skillDocument, { status: 200 }));
  });

  it('maps malformed skill documents to BAD_REQUEST', async () => {
    await expect(
      createCaller().installSkill({ instructions: 'not a skill', sourceType: 'url' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(create).not.toHaveBeenCalled();
  });

  it('persists a local skill file without a remote source URL', async () => {
    await createCaller().installSkill({
      instructions: skillDocument,
      sourceRef: 'summarize-text.skill',
      sourceType: 'file',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'summarize-text',
        sourceRef: 'summarize-text.skill',
        sourceType: 'file',
        sourceUrl: undefined,
      }),
    );
  });

  it('rejects a local skill file that includes a source URL', async () => {
    await expect(
      createCaller().installSkill({
        instructions: skillDocument,
        sourceType: 'file',
        sourceUrl: 'https://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(create).not.toHaveBeenCalled();
  });

  it('does not accept local files through the remote URL installer', async () => {
    await expect(
      createCaller().installSkillFromUrl({
        sourceType: 'file' as never,
        sourceUrl: 'https://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('maps invalid source URLs to BAD_REQUEST', async () => {
    await expect(
      createCaller().installSkillFromUrl({
        sourceType: 'url',
        sourceUrl: 'http://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('maps a registry identifier mismatch to BAD_REQUEST', async () => {
    await expect(
      createCaller().installSkillFromUrl({
        expectedIdentifier: 'reviewer',
        sourceType: 'registry',
        sourceUrl: 'https://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: '23505',
      constraint: 'user_installed_skills_user_hash_unique',
    },
    {
      cause: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint user_installed_skills_user_hash_unique',
      },
    },
  ])('maps duplicate content errors to CONFLICT', async (databaseError) => {
    create.mockRejectedValueOnce(databaseError);

    await expect(
      createCaller().installSkill({ instructions: skillDocument, sourceType: 'url' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'A skill with identical content is already installed under a different identifier',
    });
  });

  it('maps non-success source responses to BAD_REQUEST', async () => {
    ssrfSafeFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(
      createCaller().installSkillFromUrl({
        sourceType: 'url',
        sourceUrl: 'https://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('maps oversized source responses to PAYLOAD_TOO_LARGE', async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response('oversized', {
        headers: { 'content-length': String(MAX_SKILL_BYTES + 1) },
        status: 200,
      }),
    );

    await expect(
      createCaller().installSkillFromUrl({
        sourceType: 'url',
        sourceUrl: 'https://example.com/SKILL.md',
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
