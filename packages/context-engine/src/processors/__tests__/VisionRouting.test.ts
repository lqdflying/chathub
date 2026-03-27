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

    // Reset fetch to a no-op that returns network error by default
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
  });

  afterAll(() => {
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

    // Chain fetch calls: first returns image data, second returns VL response
    global.fetch = vi
      .fn()
      // First call: fetch image URL -> returns image as blob
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new ArrayBuffer(8),
      })
      // Second call: VL API -> returns description
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'A cat sitting on a table' }),
      });

    const result = await processor.process(context as any);

    // Verify VL API was called with correct endpoint and format
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const vlCall = global.fetch.mock.calls[1];
    expect(vlCall[0]).toBe('https://api.minimax.io/v1/coding_plan/vlm');
    expect(vlCall[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
    });
    // Body should have prompt and image_url (base64 data URL)
    const body = JSON.parse(vlCall[1].body);
    expect(body.prompt).toBeTruthy();
    expect(body.image_url).toMatch(/^data:image\/png;base64,/);

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

    // Chain: first fetch succeeds, second (VL API) fails
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new ArrayBuffer(8),
      })
      .mockRejectedValueOnce(new Error('Network error'));

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

    // Chain: first fetch for image, second VL API call, third fetch for second image, fourth VL API
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new ArrayBuffer(8),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'A cat' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new ArrayBuffer(8),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'Another image' }),
      });

    await processor.process(context as any);

    // Only user message should trigger VL call (2 fetch calls: image + VL)
    // Assistant message should be skipped (4 total calls if both were processed)
    // But actually only user message has imageList checked
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
