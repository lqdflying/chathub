// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildMinimaxOpenAIChatPayload } from './index';

describe('buildMinimaxOpenAIChatPayload', () => {
  it('defaults reasoning_split to true when payload omits it', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
    } as any);
    expect(out.reasoning_split).toBe(true);
  });

  it('connectivity probe keeps reasoning_split false and respects max_tokens', () => {
    const out = buildMinimaxOpenAIChatPayload({
      max_tokens: 256,
      messages: [{ content: 'hello', role: 'user' }],
      model: 'MiniMax-M2.5',
      reasoning_split: false,
    } as any);

    expect(out.reasoning_split).toBe(false);
    expect(out.max_tokens).toBe(256);
  });

  it('sets reasoning_split false when payload has reasoning_split: false', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
      reasoning_split: false,
    } as any);
    expect(out.reasoning_split).toBe(false);
  });

  it('passes tools through', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.5',
      reasoning_split: true,
      tools,
    } as any);
    expect(out.tools).toEqual(tools);
  });
});
