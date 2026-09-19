// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeXaiAI, buildXaiPayload, XAI_OAUTH_AUTH_MODE, XAI_OAUTH_CLIENT_HEADERS } from './index';

describe('buildXaiPayload', () => {
  it('sends Grok 4.6 high effort by default and strips sampling', () => {
    const payload = buildXaiPayload({
      frequency_penalty: 0.2,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'grok-4.6',
      presence_penalty: 0.1,
      stop: ['END'],
      temperature: 0.4,
      top_p: 0.8,
    } as any);

    expect(payload.reasoning_effort).toBe('high');
    expect(payload).not.toHaveProperty('frequency_penalty');
    expect(payload).not.toHaveProperty('presence_penalty');
    expect(payload).not.toHaveProperty('stop');
    expect(payload).not.toHaveProperty('temperature');
    expect(payload).not.toHaveProperty('top_p');
    expect(payload).not.toHaveProperty('enabledSearch');
    expect(payload).not.toHaveProperty('provider');
  });

  it('maps leftover Grok 4.5 xhigh to high', () => {
    expect(
      buildXaiPayload({
        messages: [],
        model: 'grok-4.5',
        reasoning_effort: 'xhigh',
      } as any).reasoning_effort,
    ).toBe('high');
  });

  it('keeps sampling when Grok 4.3 effort is none', () => {
    const payload = buildXaiPayload({
      messages: [],
      model: 'grok-4.3',
      reasoning_effort: 'none',
      temperature: 0.2,
    } as any);

    expect(payload.reasoning_effort).toBe('none');
    expect(payload.temperature).toBe(0.2);
  });

  it('normalizes invalid Grok 4.6 and 4.5 leftover efforts', () => {
    expect(
      buildXaiPayload({
        messages: [],
        model: 'grok-4.6',
        reasoning_effort: 'none',
      } as any).reasoning_effort,
    ).toBe('high');
    expect(
      buildXaiPayload({
        messages: [],
        model: 'grok-4.5',
        reasoning_effort: 'xhigh',
      } as any).reasoning_effort,
    ).toBe('high');
  });

  it('adds Responses web_search only when search is enabled', () => {
    const withSearch = buildXaiPayload({
      apiMode: 'responses',
      enabledSearch: true,
      messages: [],
      model: 'grok-4.6',
      tools: [{ function: { name: 'local' }, type: 'function' }],
    } as any);

    expect(withSearch.tools).toEqual(
      expect.arrayContaining([
        { function: { name: 'local' }, type: 'function' },
        { type: 'web_search' },
      ]),
    );

    const chatCompletions = buildXaiPayload({
      enabledSearch: true,
      messages: [],
      model: 'grok-4.6',
    } as any);

    expect(chatCompletions.tools).toBeUndefined();
    expect(chatCompletions).not.toHaveProperty('web_search');
  });
});

describe('LobeXaiAI cache and OAuth headers', () => {
  it('sends x-grok-conv-id and not Session_id on Chat Completions', async () => {
    const instance = new LobeXaiAI({ apiKey: 'test-key' });
    const mockStream = (async function* () {})();
    const createSpy = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(mockStream as any);

    const response = await instance.chat(
      {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.6',
      },
      { trustedPromptCacheKey: 'ch_testcachekey000000000000000001' },
    );
    await response.text();

    const requestPayload = createSpy.mock.calls[0][0] as any;
    const requestOptions = createSpy.mock.calls[0][1] as any;

    expect(requestPayload).not.toHaveProperty('prompt_cache_key');
    expect(requestOptions.headers['x-grok-conv-id']).toBe('ch_testcachekey000000000000000001');
    expect(requestOptions.headers).not.toHaveProperty('Session_id');
  });

  it('sends prompt_cache_key on Responses and omits Session_id', async () => {
    const instance = new LobeXaiAI({ apiKey: 'test-key' });
    const mockStream = (async function* () {})();
    const createSpy = vi
      .spyOn(instance['client'].responses, 'create')
      .mockResolvedValue(mockStream as any);

    const response = await instance.chat(
      {
        apiMode: 'responses',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.6',
      },
      { trustedPromptCacheKey: 'ch_testcachekey000000000000000002' },
    );
    await response.text();

    const requestPayload = createSpy.mock.calls[0][0] as any;
    const requestOptions = createSpy.mock.calls[0][1] as any;

    expect(requestPayload.prompt_cache_key).toBe('ch_testcachekey000000000000000002');
    expect(requestOptions.headers).not.toHaveProperty('Session_id');
    expect(requestOptions.headers).not.toHaveProperty('x-grok-conv-id');
  });

  it('sends Grok 4.3 none on Chat Completions and Responses', async () => {
    const instance = new LobeXaiAI({ apiKey: 'test-key' });
    const mockStream = (async function* () {})();
    const chatSpy = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(mockStream as any);
    const responsesSpy = vi
      .spyOn(instance['client'].responses, 'create')
      .mockResolvedValue(mockStream as any);

    await (
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.3',
        reasoning_effort: 'none',
      } as any)
    ).text();
    expect((chatSpy.mock.calls[0][0] as any).reasoning_effort).toBe('none');

    await (
      await instance.chat({
        apiMode: 'responses',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'grok-4.3',
        reasoning_effort: 'none',
      } as any)
    ).text();
    expect((responsesSpy.mock.calls[0][0] as any).reasoning).toMatchObject({ effort: 'none' });
  });

  it('attaches SuperGrok CLI headers only for OAuth', () => {
    const oauth = new LobeXaiAI({ apiKey: 'oauth-token', authMode: XAI_OAUTH_AUTH_MODE });
    const apiKey = new LobeXaiAI({ apiKey: 'console-key' });

    expect(oauth['client']._options.defaultHeaders).toMatchObject(XAI_OAUTH_CLIENT_HEADERS);
    expect(apiKey['client']._options.defaultHeaders).not.toMatchObject(XAI_OAUTH_CLIENT_HEADERS);
  });
});
