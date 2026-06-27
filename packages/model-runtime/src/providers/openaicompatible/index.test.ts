// @vitest-environment node
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleAI } from './index';

vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOpenAICompatibleAI', () => {
  let instance: InstanceType<typeof LobeOpenAICompatibleAI>;

  beforeEach(() => {
    instance = new LobeOpenAICompatibleAI({
      apiKey: 'test',
      baseURL: 'https://gateway.example.com/v1',
    });

    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses Chat Completions by default', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();
    expect(instance['client'].responses.create).not.toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      stream: true,
    });
    expect(createCall).not.toHaveProperty('apiMode');
  });

  it('strips explicit Chat Completions mode from provider payload', async () => {
    await instance.chat({
      apiMode: 'chatCompletion',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).not.toHaveProperty('apiMode');
  });

  it('uses Responses API when apiMode is responses', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].responses.create).toHaveBeenCalled();
    expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.5',
      store: false,
      stream: true,
    });
    expect(createCall).not.toHaveProperty('apiMode');
    expect(createCall.input).toEqual([{ content: 'Hello', role: 'user' }]);
  });
});
