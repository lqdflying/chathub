import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { VisionRoutingProcessor } from '../VisionRouting';

describe('VisionRoutingProcessor', () => {
  const mockIsCanUseVision = vi.fn();
  const mockGetApiKey = vi.fn().mockReturnValue('test-api-key');
  const mockGetBaseUrl = vi.fn().mockReturnValue('https://api.minimax.io/v1');

  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset mock implementations
    mockIsCanUseVision.mockReset();
    mockGetApiKey.mockReset();
    mockGetBaseUrl.mockReset();

    // Re-setup default returns
    mockIsCanUseVision.mockReturnValue(false);
    mockGetApiKey.mockReturnValue('test-api-key');
    mockGetBaseUrl.mockReturnValue('https://api.minimax.io/v1');

    // Reset fetch to original before each test, then assign fresh mock
    global.fetch = vi.fn();
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should skip routing when model supports vision', async () => {
    mockIsCanUseVision.mockReturnValue(true);
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.messages[0].imageList).toHaveLength(1); // unchanged
  });

  it('should skip routing when no images', async () => {
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [{ id: '1', role: 'user', content: 'Hello' }],
      metadata: {},
    };

    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should skip routing when api key is missing', async () => {
    mockGetApiKey.mockReturnValue(undefined);
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    const result = await processor.process(context as any);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should call VL API and inject description', async () => {
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A cat sitting on a table' } }],
      }),
    });

    const result = await processor.process(context as any);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('MiniMaxAI/MiniMax-VL-01'),
      }),
    );

    expect(result.messages[0].content).toBe(
      'What is this?\n\n[Image 1 description: A cat sitting on a table]',
    );
    expect(result.messages[0].imageList).toHaveLength(0);
  });

  it('should handle VL API failure gracefully', async () => {
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await processor.process(context as any);

    // Should continue without image
    expect(result.messages[0].content).toBe('What is this?');
    expect(result.messages[0].imageList).toHaveLength(1); // still present
  });

  it('should only process user messages', async () => {
    const processor = new VisionRoutingProcessor({
      getApiKey: mockGetApiKey,
      getBaseUrl: mockGetBaseUrl,
      isCanUseVision: mockIsCanUseVision,
    });
    const context = {
      initialState: { messages: [] },
      isAborted: false,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'What is this?',
          imageList: [{ id: 'img1', url: 'https://example.com/image.png' }],
        },
        {
          id: '2',
          role: 'assistant',
          content: 'I see a cat',
          imageList: [{ id: 'img2', url: 'https://example.com/image2.png' }],
        },
      ],
      metadata: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A cat' } }],
      }),
    });

    await processor.process(context as any);

    // Only user message should trigger fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
