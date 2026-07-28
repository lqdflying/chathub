import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { createHeaderWithAuthSync } from '../_auth';
import { createHeaderWithOpenAI } from '../_header';

vi.mock('../_auth', () => ({
  createHeaderWithAuthSync: vi.fn(() => ({
    'X-lobe-chat-auth': 'encrypted-payload',
  })),
}));

describe('createHeaderWithOpenAI', () => {
  it('uses the standard encrypted provider-auth header', () => {
    expect(createHeaderWithOpenAI({ Accept: 'audio/mpeg' })).toEqual({
      'X-lobe-chat-auth': 'encrypted-payload',
    });
    expect(createHeaderWithAuthSync).toHaveBeenCalledWith({
      headers: { Accept: 'audio/mpeg' },
      provider: ModelProvider.OpenAI,
    });
  });
});
