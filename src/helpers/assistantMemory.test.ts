import { ASSISTANT_MEMORY_MAX_CHARS } from '@lobechat/prompts';
import { describe, expect, it, vi } from 'vitest';

import {
  capAssistantMemoryByTokensAsync,
  hashText,
  normalizeAssistantMemoryText,
} from './assistantMemory';

const { encodeAsync } = vi.hoisted(() => ({ encodeAsync: vi.fn() }));

vi.mock('@/utils/tokenizer', () => ({ encodeAsync }));

describe('normalizeAssistantMemoryText', () => {
  it('strips wrapping fences and common assistant-memory preambles', () => {
    const text = normalizeAssistantMemoryText(
      '```markdown\nHere is the updated assistant memory:\n- User prefers concise answers.\n```',
    );

    expect(text).toBe('- User prefers concise answers.');
  });

  it('strips Chinese preambles', () => {
    expect(normalizeAssistantMemoryText('以下是更新后的助手记忆：\n- 用户偏好简洁回答。')).toBe(
      '- 用户偏好简洁回答。',
    );
    expect(normalizeAssistantMemoryText('更新后的记忆：\n- 内容')).toBe('- 内容');
  });

  it('strips Japanese preambles', () => {
    expect(normalizeAssistantMemoryText('更新されたアシスタントメモリ：\n- 内容')).toBe('- 内容');
  });

  it('strips a generic first line labelled as memory output', () => {
    expect(
      normalizeAssistantMemoryText('Sure! Below is the new assistant memory:\n- item one'),
    ).toBe('- item one');
  });

  it('keeps ordinary content that merely mentions memory', () => {
    const text = '- Remember: the assistant memory feature matters to the user.';
    expect(normalizeAssistantMemoryText(text)).toBe(text);
  });

  it('caps long memory at the hard assistant memory character budget', () => {
    const text = normalizeAssistantMemoryText('a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500));

    expect(text.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
  });
});

describe('hashText', () => {
  it('is deterministic and length-sensitive', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('abc')).not.toBe(hashText('abcd'));
    expect(hashText('')).toBe(hashText(''));
  });

  it('handles CJK content', () => {
    expect(hashText('用户偏好简洁')).toBe(hashText('用户偏好简洁'));
    expect(hashText('用户偏好简洁')).not.toBe(hashText('用户偏好详细'));
  });
});

describe('capAssistantMemoryByTokensAsync', () => {
  it('returns the text unchanged when within the token allowance', async () => {
    encodeAsync.mockResolvedValueOnce(700);

    await expect(capAssistantMemoryByTokensAsync('short memory', 800)).resolves.toBe(
      'short memory',
    );
  });

  it('cuts proportionally when over the allowance', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    // first count: way over; second count (after cut): within allowance
    encodeAsync.mockResolvedValueOnce(1600).mockResolvedValueOnce(750);

    const result = await capAssistantMemoryByTokensAsync(text, 800);

    expect(result.length).toBeLessThan(text.length);
    expect(result.length).toBeLessThanOrEqual(Math.floor((text.length * 800) / 1600));
  });

  it('falls back to the character cap when the tokenizer fails', async () => {
    encodeAsync.mockRejectedValueOnce(new Error('worker down'));

    const long = 'a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500);
    const result = await capAssistantMemoryByTokensAsync(long, 800);

    expect(result.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
  });

  it('returns empty for blank input without calling the tokenizer', async () => {
    encodeAsync.mockClear();
    await expect(capAssistantMemoryByTokensAsync('   ', 800)).resolves.toBe('');
    expect(encodeAsync).not.toHaveBeenCalled();
  });
});
