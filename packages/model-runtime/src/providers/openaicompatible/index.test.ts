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

  it('forwards documented Chat Completions fields and strips internal routing fields', async () => {
    await instance.chat({
      enabledContextCaching: true,
      enabledSearch: false,
      frequency_penalty: 0.5,
      max_tokens: 4096,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      presence_penalty: 0.3,
      provider: 'openaicompatible',
      reasoning: { effort: 'high' },
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      text: { verbosity: 'low' },
      tool_choice: 'auto',
      tools: [{ function: { name: 'f', parameters: {} }, type: 'function' }],
      top_p: 0.9,
      truncation: 'auto',
      verbosity: 'medium',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];

    // Documented Chat Completions fields forwarded
    expect(createCall).toMatchObject({
      frequency_penalty: 0.5,
      max_tokens: 4096,
      model: 'gpt-5.5',
      presence_penalty: 0.3,
      reasoning: { effort: 'high' },
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      tool_choice: 'auto',
      tools: [{ function: { name: 'f', parameters: {} }, type: 'function' }],
      top_p: 0.9,
    });

    // Responses-API-only fields stripped in Chat Completions mode
    expect(createCall).not.toHaveProperty('text');
    expect(createCall).not.toHaveProperty('verbosity');
    expect(createCall).not.toHaveProperty('truncation');

    // Internal routing / feature fields stripped
    expect(createCall).not.toHaveProperty('apiMode');
    expect(createCall).not.toHaveProperty('enabledContextCaching');
    expect(createCall).not.toHaveProperty('enabledSearch');
    expect(createCall).not.toHaveProperty('provider');
    expect(createCall).not.toHaveProperty('responseMode');
    expect(createCall).not.toHaveProperty('thinkingBudget');
    expect(createCall).not.toHaveProperty('urlContext');
    expect(createCall).not.toHaveProperty('reasoning_split');
  });

  it('strips undefined optional fields instead of sending them as null', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).not.toHaveProperty('temperature');
    expect(createCall).not.toHaveProperty('top_p');
    expect(createCall).not.toHaveProperty('max_tokens');
    expect(createCall).not.toHaveProperty('tools');
    expect(createCall).not.toHaveProperty('reasoning');
    expect(createCall).not.toHaveProperty('text');
    expect(createCall).not.toHaveProperty('verbosity');
    expect(createCall).not.toHaveProperty('truncation');
  });

  it('forwards Responses-API-only fields (text, verbosity, truncation) in Responses mode', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      text: { verbosity: 'low' },
      truncation: 'auto',
      verbosity: 'medium',
    });

    expect(instance['client'].responses.create).toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    // The factory forwards the original payload to Responses mode, so these
    // Responses-API fields survive through handleResponseAPIMode.
    expect(createCall).toMatchObject({
      model: 'gpt-5.5',
      text: { verbosity: 'low' },
      truncation: 'auto',
      verbosity: 'medium',
    });
  });
});
