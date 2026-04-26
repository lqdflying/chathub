import { describe, expect, it } from 'vitest';

import { buildDeepSeekPayload } from './index';

describe('buildDeepSeekPayload', () => {
  const basePayload = {
    messages: [{ content: 'Hello', role: 'user' }],
    model: 'deepseek-v4-pro',
  } as any;

  it('should pass through all standard params when thinking is disabled', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'disabled' as const },
      top_p: 0.9,
    });

    expect(payload.model).toBe('deepseek-v4-pro');
    expect(payload.temperature).toBe(0.8);
    expect(payload.top_p).toBe(0.9);
    expect(payload.frequency_penalty).toBe(0.5);
    expect(payload.presence_penalty).toBe(0.3);
    expect(payload.thinking).toBeUndefined();
    expect(payload.stream).toBe(true);
  });

  it('should strip sampling params when thinking is enabled', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'enabled' as const },
      top_p: 0.9,
    });

    expect(payload.model).toBe('deepseek-v4-pro');
    expect(payload.temperature).toBeUndefined();
    expect(payload.top_p).toBeUndefined();
    expect(payload.frequency_penalty).toBeUndefined();
    expect(payload.presence_penalty).toBeUndefined();
    expect(payload.thinking).toBeUndefined();
    expect(payload.stream).toBe(true);
  });

  it('should forward reasoning_effort when provided', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      reasoning_effort: 'max',
      thinking: { type: 'enabled' as const },
    });

    expect(payload.reasoning_effort).toBe('max');
    expect(payload.thinking).toBeUndefined();
  });

  it('should forward tools when provided', () => {
    const tools = [
      {
        function: { description: 'Test tool', name: 'test' },
        type: 'function' as const,
      },
    ];

    const payload = buildDeepSeekPayload({
      ...basePayload,
      tools,
    });

    expect(payload.tools).toEqual(tools);
  });

  it('should handle no thinking param (defaults to standard mode)', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      temperature: 1,
    });

    expect(payload.temperature).toBe(1);
    expect(payload.thinking).toBeUndefined();
  });
});
