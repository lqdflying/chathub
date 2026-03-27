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

    // Mock the VL API call
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A terminal showing git worktree removal commands' } }],
      }),
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

    // Verify VL was called
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('MiniMaxAI/MiniMax-VL-01'),
      }),
    );

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
