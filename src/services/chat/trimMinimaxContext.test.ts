/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trimMinimaxChatContext } from './trimMinimaxContext';

vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: vi.fn(async (str: string) => str.length),
}));

describe('trimMinimaxChatContext', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does not import the client AI-infra store helper', () => {
    const source = readFileSync('src/services/chat/trimMinimaxContext.ts', 'utf8');
    expect(source).not.toContain("@/helpers/modelContextWindowTokens");
    expect(source).not.toContain("@/store/aiInfra");
  });

  it('keeps short histories under the model-bank window without a store lookup', async () => {
    const messages = [
      { content: 'system', role: 'system' as const },
      { content: 'hello', role: 'user' as const },
    ];

    await expect(trimMinimaxChatContext(messages, undefined, 'MiniMax-M3')).resolves.toEqual(
      messages,
    );
  });

  it('honors an explicit context window override for trimming', async () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      content: `turn-${index}-${'x'.repeat(400)}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    }));

    const trimmed = await trimMinimaxChatContext(messages, undefined, 'unknown-model', 1, 100);

    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed.at(-1)?.content).toBe(messages.at(-1)?.content);
  });
});
