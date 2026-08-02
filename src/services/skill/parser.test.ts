import { describe, expect, it } from 'vitest';

import { normalizeSkillSource, parseSkill, resolveSkillSource } from './parser';

const skillDocument = `---
name: summarize-text
description: Summarize a document in a fixed format.
---

Follow the requested output format exactly.
`;

describe('skill parser', () => {
  it('parses metadata and keeps instructions separate', () => {
    const parsed = parseSkill(skillDocument);

    expect(parsed).toMatchObject({
      description: 'Summarize a document in a fixed format.',
      instructions: 'Follow the requested output format exactly.',
      name: 'summarize-text',
    });
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects malformed skill names and empty instructions', () => {
    expect(() => parseSkill(skillDocument.replace('summarize-text', 'Summarize Text'))).toThrow(
      'Skill name',
    );
    expect(() =>
      parseSkill(skillDocument.replace('Follow the requested output format exactly.', '')),
    ).toThrow('instructions cannot be empty');
  });

  it('normalizes GitHub repository and blob sources to raw SKILL.md URLs', () => {
    expect(normalizeSkillSource('https://github.com/acme/example')).toBe(
      'https://raw.githubusercontent.com/acme/example/main/SKILL.md',
    );
    expect(resolveSkillSource('https://github.com/acme/example/blob/main/docs/SKILL.md')).toEqual({
      sourceRef: 'main',
      sourceType: 'github',
      sourceUrl: 'https://raw.githubusercontent.com/acme/example/main/docs/SKILL.md',
    });
  });
});
