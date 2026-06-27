import { ASSISTANT_MEMORY_MAX_CHARS } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { normalizeAssistantMemoryText } from './assistantMemory';

describe('normalizeAssistantMemoryText', () => {
  it('strips wrapping fences and common assistant-memory preambles', () => {
    const text = normalizeAssistantMemoryText(
      '```markdown\nHere is the updated assistant memory:\n- User prefers concise answers.\n```',
    );

    expect(text).toBe('- User prefers concise answers.');
  });

  it('caps long memory at the hard assistant memory character budget', () => {
    const text = normalizeAssistantMemoryText('a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500));

    expect(text.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
  });
});
