import { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contextEngineering } from './contextEngineering';
import * as helpers from './helper';

// Mock VARIABLE_GENERATORS
vi.mock('@/utils/client/parserPlaceholder', () => ({
  VARIABLE_GENERATORS: {
    date: () => '2023-12-25',
    time: () => '14:30:45',
    username: () => 'TestUser',
    random: () => '12345',
  },
}));

// Default isServerMode
let isServerMode = false;

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    get isServerMode() {
      return isServerMode;
    },
    isDeprecatedEdition: false,
    isDesktop: false,
  };
});

// Mock the store to return API key for MiniMax
vi.mock('@/store/aiInfra', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    aiProviderSelectors: {
      ...actual.aiProviderSelectors,
      providerKeyVaults: () => () => ({
        apiKey: 'test-minimax-key',
        baseURL: 'https://api.minimax.io/v1',
      }),
    },
  };
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('contextEngineering vision routing', () => {
  beforeEach(() => {
    isServerMode = true;
  });

  it('should extract image description via MiniMax-VL-01 when model lacks vision', async () => {
    // Mock isCanUseVision to return false for MiniMax
    vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(false);

    // Chain fetch calls: first returns image as blob, second returns VL description
    global.fetch = vi
      .fn()
      // First call: fetch image URL
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new ArrayBuffer(8),
      })
      // Second call: VL API returns description
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'A terminal showing git worktree removal commands' }),
      });

    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'What do you see?',
        imageList: [{ id: 'img1', url: 'https://example.com/terminal.png' }],
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });

    // Verify VL API was called with correct endpoint and format
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const vlCall = global.fetch.mock.calls[1];
    expect(vlCall[0]).toBe('https://api.minimax.io/v1/coding_plan/vlm');
    expect(vlCall[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-minimax-key',
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(vlCall[1].body);
    expect(body.prompt).toBeTruthy();
    expect(body.image_url).toMatch(/^data:image\/png;base64,/);

    // Verify description was injected
    expect(result[0].content).toContain('A terminal showing git worktree removal commands');
  });

  it('should skip vision routing when model supports vision', async () => {
    vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'What do you see?',
        imageList: [{ id: 'img1', url: 'https://example.com/terminal.png' }],
      },
    ];

    await contextEngineering({
      messages,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });

    // VL should not be called when model supports vision
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
