import { describe, expect, it } from 'vitest';

import { parseSkillRegistry } from './registry';

describe('parseSkillRegistry', () => {
  it('adapts common SkillMD registry shapes to metadata-only catalog items', () => {
    const result = parseSkillRegistry({
      skills: [
        {
          description: 'Summarize text.',
          identifier: 'summarize-text',
          path: 'skills/summarize',
          ref: 'main',
          repository: 'acme/skills',
        },
      ],
    });

    expect(result).toEqual([
      {
        description: 'Summarize text.',
        identifier: 'summarize-text',
        name: 'summarize-text',
        sourceRef: 'main',
        sourceType: 'registry',
        sourceUrl: 'https://raw.githubusercontent.com/acme/skills/main/skills/summarize/SKILL.md',
      },
    ]);
    expect(result[0]).not.toHaveProperty('instructions');
  });

  it('filters invalid, duplicate, and non-matching entries', () => {
    expect(
      parseSkillRegistry(
        [
          { description: 'valid', identifier: 'valid-skill', url: 'https://example.com/skill.md' },
          { description: 'duplicate', identifier: 'valid-skill', url: 'https://example.com/2.md' },
          { description: 'bad name', identifier: 'Bad Skill', url: 'https://example.com/bad.md' },
        ],
        'valid',
      ),
    ).toHaveLength(1);
  });
});
