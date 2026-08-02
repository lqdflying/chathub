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

  it('preserves leading whitespace when no skill command is consumed', () => {
    expect(parseSkillActivations('  indented code', [])).toEqual({
      activatedSkillIds: [],
      content: '  indented code',
      unknownSkillIds: [],
    });
  });

  it('preserves the original content when the first command is unknown', () => {
    expect(parseSkillActivations('  /not-enabled hello', ['summarize-text'])).toEqual({
      activatedSkillIds: [],
      content: '  /not-enabled hello',
      unknownSkillIds: ['not-enabled'],
    });
  });

  it('keeps an unknown command after consuming a known command', () => {
    expect(
      parseSkillActivations('/summarize-text /not-enabled hi', ['summarize-text']),
    ).toEqual({
      activatedSkillIds: ['summarize-text'],
      content: '/not-enabled hi',
      unknownSkillIds: ['not-enabled'],
    });
  });
});
