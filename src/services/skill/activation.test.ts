import { describe, expect, it } from 'vitest';

import { parseSkillActivations } from './activation';

describe('parseSkillActivations', () => {
  it('activates multiple leading skill commands and strips them', () => {
    expect(
      parseSkillActivations('  /summarize-text /translate-text hello', [
        'summarize-text',
        'translate-text',
      ]),
    ).toEqual({
      activatedSkillIds: ['summarize-text', 'translate-text'],
      content: 'hello',
      unknownSkillIds: [],
    });
  });

  it('does not consume an unknown leading command', () => {
    expect(parseSkillActivations('/not-enabled hello', ['summarize-text'])).toEqual({
      activatedSkillIds: [],
      content: '/not-enabled hello',
      unknownSkillIds: ['not-enabled'],
    });
  });

  it('does not treat a slash in the body as an activation', () => {
    expect(parseSkillActivations('hello /summarize-text', ['summarize-text'])).toEqual({
      activatedSkillIds: [],
      content: 'hello /summarize-text',
      unknownSkillIds: [],
    });
  });
});
