import { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as isCanUseFCModule from '@/helpers/isCanUseFC';

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

const resolvePublicUrlQuery = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { file: { resolvePublicUrl: { query: resolvePublicUrlQuery } } },
}));

// 默认设置 isServerMode 为 false
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

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('contextEngineering', () => {
  describe('handle with files content in server mode', () => {
    it('should includes files', async () => {
      isServerMode = true;
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages = [
        {
          content: 'Hello',
          role: 'user',
          imageList: [
            {
              id: 'imagecx1',
              url: 'http://example.com/xxx0asd-dsd.png',
              alt: 'ttt.png',
            },
          ],
          fileList: [
            {
              fileType: 'plain/txt',
              size: 100000,
              id: 'file1',
              url: 'http://abc.com/abc.txt',
              name: 'abc.png',
            },
            {
              id: 'file_oKMve9qySLMI',
              name: '2402.16667v1.pdf',
              type: 'application/pdf',
              size: 11256078,
              url: 'https://xxx.com/ppp/480497/5826c2b8-fde0-4de1-a54b-a224d5e3d898.pdf',
            },
          ],
        }, // Message with files
        { content: 'Hey', role: 'assistant' }, // Regular user message
      ] as UIChatMessage[];

      const output = await contextEngineering({
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(output).toEqual([
        {
          content: [
            {
              text: `Hello

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="ttt.png" url="http://example.com/xxx0asd-dsd.png"></image>
</images>
<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
<file id="file1" name="abc.png" type="plain/txt" size="100000" url="http://abc.com/abc.txt"></file>
<file id="file_oKMve9qySLMI" name="2402.16667v1.pdf" type="undefined" size="11256078" url="https://xxx.com/ppp/480497/5826c2b8-fde0-4de1-a54b-a224d5e3d898.pdf"></file>
</files>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
              type: 'text',
            },
            {
              image_url: { detail: 'auto', url: 'http://example.com/xxx0asd-dsd.png' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
        {
          content: 'Hey',
          role: 'assistant',
        },
      ]);

      isServerMode = false;
    });

    it('should include image files in server mode', async () => {
      isServerMode = true;

      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(false);

      const messages = [
        {
          content: 'Hello',
          role: 'user',
          imageList: [
            {
              id: 'file1',
              url: 'http://example.com/image.jpg',
              alt: 'abc.png',
            },
          ],
        }, // Message with files
        { content: 'Hey', role: 'assistant' }, // Regular user message
      ] as UIChatMessage[];
      const output = await contextEngineering({
        messages,
        provider: 'openai',
        model: 'gpt-4-vision-preview',
      });

      expect(output).toEqual([
        {
          content: [
            {
              text: `Hello

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="abc.png" url="http://example.com/image.jpg"></image>
</images>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
              type: 'text',
            },
          ],
          role: 'user',
        },
        {
          content: 'Hey',
          role: 'assistant',
        },
      ]);

      isServerMode = false;
    });

    it('resolves proxy image urls per image and keeps the send alive when one fails', async () => {
      isServerMode = true;
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);
      resolvePublicUrlQuery.mockImplementation(async ({ url }: { url: string }) => {
        if (url.includes('good')) return 'https://s3.example.com/good.png';
        throw new Error('file_not_found');
      });

      const messages = [
        {
          content: 'Hello',
          role: 'user',
          imageList: [
            {
              id: 'img-good',
              url: 'https://chat.example.com/webapi/files/files/1/good.png',
              alt: 'good.png',
            },
            {
              id: 'img-stale',
              url: 'https://chat.example.com/webapi/files/files/1/stale.png',
              alt: 'stale.png',
            },
          ],
        },
      ] as UIChatMessage[];

      const output = await contextEngineering({
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      const imageParts = (output[0].content as any[]).filter((part) => part.type === 'image_url');
      expect(imageParts.map((part) => part.image_url.url)).toEqual([
        'https://s3.example.com/good.png',
        // the stale reference keeps its proxy URL instead of failing the whole request
        'https://chat.example.com/webapi/files/files/1/stale.png',
      ]);

      isServerMode = false;
    });
  });

  it('should handle empty tool calls messages correctly', async () => {
    const messages = [
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [],
      },
    ] as UIChatMessage[];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toEqual([
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
      },
    ]);
  });

  it('should handle assistant messages with reasoning correctly', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'The answer is 42.',
        reasoning: {
          content: 'I need to calculate the answer to life, universe, and everything.',
          signature: 'thinking_process',
        },
      },
    ] as UIChatMessage[];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toEqual([
      {
        content: [
          {
            signature: 'thinking_process',
            thinking: 'I need to calculate the answer to life, universe, and everything.',
            type: 'thinking',
          },
          {
            text: 'The answer is 42.',
            type: 'text',
          },
        ],
        reasoning: {
          content: 'I need to calculate the answer to life, universe, and everything.',
          signature: 'thinking_process',
        },
        role: 'assistant',
      },
    ]);
  });

  it('should inject INBOX_GUIDE_SYSTEM_ROLE for welcome questions in inbox session', async () => {
    // Don't mock INBOX_GUIDE_SYSTEMROLE, use the real one
    const messages: UIChatMessage[] = [
      {
        role: 'user',
        content: 'Hello, this is my first question',
        createdAt: Date.now(),
        id: 'test-welcome',
        meta: {},
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      provider: 'openai',
      isWelcomeQuestion: true,
      sessionId: 'inbox',
    });

    // Should have system message with inbox guide content
    const systemMessage = result.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    // Check for characteristic content of the actual INBOX_GUIDE_SYSTEMROLE
    expect(systemMessage!.content).toContain('LobeChat Support Assistant');
    expect(systemMessage!.content).toContain('');
    expect(Object.keys(systemMessage!).length).toEqual(2);
  });

  it('should inject historySummary into system message when provided', async () => {
    const historySummary = 'Previous conversation summary: User discussed AI topics.';

    const messages: UIChatMessage[] = [
      {
        role: 'user',
        content: 'Continue our discussion',
        createdAt: Date.now(),
        id: 'test-history',
        meta: {},
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      historySummary,
      provider: 'openai',
    });

    // Should have system message with history summary
    const systemMessage = result.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain(historySummary);
    expect(Object.keys(systemMessage!).length).toEqual(2);
  });
  describe('getAssistantContent', () => {
    it('should handle assistant message with imageList and content', async () => {
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: UIChatMessage[] = [
        {
          role: 'assistant',
          content: 'Here is an image.',
          imageList: [{ id: 'img1', url: 'http://example.com/image.png', alt: 'test.png' }],
          createdAt: Date.now(),
          id: 'test-id',
          meta: {},
          updatedAt: Date.now(),
        },
      ];
      const result = await contextEngineering({
        messages,
        model: 'gpt-4-vision-preview',
        provider: 'openai',
      });

      expect(result[0].content).toEqual([
        { text: 'Here is an image.', type: 'text' },
        { image_url: { detail: 'auto', url: 'http://example.com/image.png' }, type: 'image_url' },
      ]);
    });

    it('should handle assistant message with imageList but no content', async () => {
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: UIChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          imageList: [{ id: 'img1', url: 'http://example.com/image.png', alt: 'test.png' }],
          createdAt: Date.now(),
          id: 'test-id-2',
          meta: {},
          updatedAt: Date.now(),
        },
      ];
      const result = await contextEngineering({
        messages,
        model: 'gpt-4-vision-preview',
        provider: 'openai',
      });

      expect(result[0].content).toEqual([
        { image_url: { detail: 'auto', url: 'http://example.com/image.png' }, type: 'image_url' },
      ]);
    });
  });

  it('should not include tool_calls for assistant message if model does not support tools', async () => {
    // Mock isCanUseFC to return false
    vi.spyOn(isCanUseFCModule, 'isCanUseFC').mockReturnValue(false);

    const messages: UIChatMessage[] = [
      {
        role: 'assistant',
        content: 'I have a tool call.',
        tools: [
          {
            id: 'tool_123',
            type: 'default',
            apiName: 'testApi',
            arguments: '{}',
            identifier: 'test-plugin',
          },
        ],
        createdAt: Date.now(),
        id: 'test-id-3',
        meta: {},
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'some-model-without-fc',
      provider: 'openai',
    });

    expect(result[0].tool_calls).toBeUndefined();
    expect(result[0].content).toBe('I have a tool call.');
  });

  describe('Process placeholder variables', () => {
    it('should process placeholder variables in string content', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello {{username}}, today is {{date}} and the time is {{time}}',
          createdAt: Date.now(),
          id: 'test-placeholder-1',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'assistant',
          content: 'Hi there! Your random number is {{random}}',
          createdAt: Date.now(),
          id: 'test-placeholder-2',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Only the last user message and system messages are expanded;
      // historical assistant messages keep their original content for prompt-cache stability.
      expect(result[0].content).toBe(
        'Hello TestUser, today is 2023-12-25 and the time is 14:30:45',
      );
      expect(result[1].content).toBe('Hi there! Your random number is {{random}}');
    });

    it('should process placeholder variables in array content', async () => {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hello {{username}}, today is {{date}}',
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc123' },
            },
          ],
          createdAt: Date.now(),
          id: 'test-placeholder-array',
          meta: {},
          updatedAt: Date.now(),
        },
      ] as any;

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(Array.isArray(result[0].content)).toBe(true);
      const content = result[0].content as any[];
      expect(content[0].text).toBe('Hello TestUser, today is 2023-12-25');
      expect(content[1].image_url.url).toBe('data:image/png;base64,abc123');
    });

    it('should handle missing placeholder variables gracefully', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello {{username}}, missing: {{missing_var}}',
          createdAt: Date.now(),
          id: 'test-placeholder-missing',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result[0].content).toBe('Hello TestUser, missing: {{missing_var}}');
    });

    it('should not modify messages without placeholder variables', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello there, no variables here',
          createdAt: Date.now(),
          id: 'test-no-placeholders',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result[0].content).toBe('Hello there, no variables here');
    });

    it('should process placeholder variables combined with other processors', async () => {
      isServerMode = true;
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello {{username}}, check this image from {{date}}',
          imageList: [
            {
              id: 'img1',
              url: 'http://example.com/test.jpg',
              alt: 'test image',
            },
          ],
          createdAt: Date.now(),
          id: 'test-combined',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(Array.isArray(result[0].content)).toBe(true);
      const content = result[0].content as any[];

      // Should contain processed placeholder variables in the text content
      expect(content[0].text).toContain('Hello TestUser, check this image from 2023-12-25');

      // Should also contain file context from MessageContentProcessor
      expect(content[0].text).toContain('SYSTEM CONTEXT');

      // Should contain image from vision processing
      expect(content[1].type).toBe('image_url');
      expect(content[1].image_url.url).toBe('http://example.com/test.jpg');

      isServerMode = false;
    });
  });

  describe('Message preprocessing processors', () => {
    it('should truncate message history when enabled', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Message 1',
          createdAt: Date.now(),
          id: 'test-1',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'assistant',
          content: 'Response 1',
          createdAt: Date.now(),
          id: 'test-2',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'Message 2',
          createdAt: Date.now(),
          id: 'test-3',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'assistant',
          content: 'Response 2',
          createdAt: Date.now(),
          id: 'test-4',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'Latest message',
          createdAt: Date.now(),
          id: 'test-5',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        enableHistoryCount: true,
        historyCount: 4, // Should keep last 2 messages
      });

      // Should only keep the last 2 messages
      expect(result).toHaveLength(4);
      expect(result).toEqual([
        { content: 'Response 1', role: 'assistant' },
        { content: 'Message 2', role: 'user' },
        { content: 'Response 2', role: 'assistant' },
        { content: 'Latest message', role: 'user' },
      ]);
    });

    it('should keep the initial request as an exact prefix of parallel tool continuations', async () => {
      vi.spyOn(isCanUseFCModule, 'isCanUseFC').mockReturnValue(true);

      const now = Date.now();
      const baseMessages = [
        {
          content: 'Discarded question',
          createdAt: now,
          id: 'discarded-user',
          meta: {},
          role: 'user',
          updatedAt: now,
        },
        {
          content: 'Discarded answer',
          createdAt: now,
          id: 'discarded-assistant',
          meta: {},
          role: 'assistant',
          updatedAt: now,
        },
        {
          content: 'Cached question',
          createdAt: now,
          id: 'cached-user',
          meta: {},
          role: 'user',
          updatedAt: now,
        },
        {
          content: 'Cached answer',
          createdAt: now,
          id: 'cached-assistant',
          meta: {},
          role: 'assistant',
          updatedAt: now,
        },
        {
          content: 'Search three sources',
          createdAt: now,
          id: 'latest-user',
          meta: {},
          role: 'user',
          updatedAt: now,
        },
      ] as UIChatMessage[];
      const tools = ['first', 'second', 'third'].map((apiName, index) => ({
        apiName,
        arguments: '{}',
        id: `call-${index + 1}`,
        identifier: 'builtin-search',
        type: 'builtin' as const,
      }));
      const continuationMessages = [
        ...baseMessages,
        {
          content: '',
          createdAt: now,
          id: 'tool-assistant',
          meta: {},
          role: 'assistant',
          tools,
          updatedAt: now,
        },
        ...tools.map((tool, index) => ({
          content: `Result ${index + 1}`,
          createdAt: now,
          id: `tool-result-${index + 1}`,
          meta: {},
          plugin: tool,
          role: 'tool',
          tool_call_id: tool.id,
          updatedAt: now,
        })),
      ] as UIChatMessage[];
      const config = {
        enableHistoryCount: true,
        historyCount: 3,
        model: 'gpt-4',
        provider: 'openai',
      };

      const initialRequest = await contextEngineering({ ...config, messages: baseMessages });
      const continuationRequest = await contextEngineering({
        ...config,
        messages: continuationMessages,
      });

      expect(initialRequest).toEqual([
        { content: 'Cached question', role: 'user' },
        { content: 'Cached answer', role: 'assistant' },
        { content: 'Search three sources', role: 'user' },
      ]);
      expect(continuationRequest.slice(0, initialRequest.length)).toEqual(initialRequest);
      expect(continuationRequest.slice(initialRequest.length).map(({ role }) => role)).toEqual([
        'assistant',
        'tool',
        'tool',
        'tool',
      ]);
      expect(continuationRequest.at(initialRequest.length)?.tool_calls).toHaveLength(3);
    });

    it('should preserve repeated tool call IDs across parent-scoped UI message rounds', async () => {
      vi.spyOn(isCanUseFCModule, 'isCanUseFC').mockReturnValue(true);

      const now = Date.now();
      const repeatedToolIds = [
        'tavily____tavily_search____mcp:7',
        'tavily____tavily_search____mcp:8',
      ];
      const createTools = () =>
        repeatedToolIds.map((id) => ({
          apiName: 'tavily_search',
          arguments: '{}',
          id,
          identifier: 'tavily',
          type: 'mcp' as const,
        }));
      const firstRoundTools = createTools();
      const secondRoundTools = createTools();
      const messages = [
        {
          content: 'Search first',
          createdAt: now,
          id: 'user-1',
          meta: {},
          role: 'user',
          updatedAt: now,
        },
        {
          content: '',
          createdAt: now,
          id: 'assistant-1',
          meta: {},
          role: 'assistant',
          tools: firstRoundTools,
          updatedAt: now,
        },
        ...firstRoundTools.map((tool, index) => ({
          content: `First result ${index + 1}`,
          createdAt: now,
          id: `first-tool-result-${index + 1}`,
          meta: {},
          parentId: 'assistant-1',
          plugin: tool,
          role: 'tool',
          tool_call_id: tool.id,
          updatedAt: now,
        })),
        {
          content: 'Search again',
          createdAt: now,
          id: 'user-2',
          meta: {},
          role: 'user',
          updatedAt: now,
        },
        {
          content: '',
          createdAt: now,
          id: 'assistant-2',
          meta: {},
          role: 'assistant',
          tools: secondRoundTools,
          updatedAt: now,
        },
        ...secondRoundTools.map((tool, index) => ({
          content: `Second result ${index + 1}`,
          createdAt: now,
          id: `second-tool-result-${index + 1}`,
          meta: {},
          parentId: 'assistant-2',
          plugin: tool,
          role: 'tool',
          tool_call_id: tool.id,
          updatedAt: now,
        })),
      ] as UIChatMessage[];

      const result = await contextEngineering({
        messages,
        model: 'kimi-k2.5',
        provider: 'moonshot',
      });

      expect(result.map(({ role }) => role)).toEqual([
        'user',
        'assistant',
        'tool',
        'tool',
        'user',
        'assistant',
        'tool',
        'tool',
      ]);
      expect(result[1].tool_calls?.map(({ id }) => id)).toEqual(repeatedToolIds);
      expect(result[2]).toMatchObject({
        content: 'First result 1',
        tool_call_id: repeatedToolIds[0],
      });
      expect(result[3]).toMatchObject({
        content: 'First result 2',
        tool_call_id: repeatedToolIds[1],
      });
      expect(result[5].tool_calls?.map(({ id }) => id)).toEqual(repeatedToolIds);
      expect(result[6]).toMatchObject({
        content: 'Second result 1',
        tool_call_id: repeatedToolIds[0],
      });
      expect(result[7]).toMatchObject({
        content: 'Second result 2',
        tool_call_id: repeatedToolIds[1],
      });
    });

    it('should apply input template to user messages', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Original user input',
          createdAt: Date.now(),
          id: 'test-template',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'assistant',
          content: 'Assistant response',
          createdAt: Date.now(),
          id: 'test-assistant',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        inputTemplate: 'Template: {{text}} - End',
      });

      // Should apply template to user message only
      expect(result).toEqual([
        {
          content: 'Template: Original user input - End',
          role: 'user',
        },
        {
          role: 'assistant',
          content: 'Assistant response',
        },
      ]);
      expect(result[1].content).toBe('Assistant response'); // Unchanged
    });

    it('should inject system role at the beginning', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          id: 'test-user',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      });

      // Should have system role at the beginning
      expect(result).toEqual([
        { content: 'You are a helpful assistant.', role: 'system' },
        { content: 'User message', role: 'user' },
      ]);
    });

    it('should prepend the system role to an existing system message when opted in', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'system',
          content: 'Imported system context',
          createdAt: Date.now(),
          id: 'test-system',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          id: 'test-user',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        existingSystemRolePolicy: 'prepend',
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'Chat Instruction\n\nAssistant role',
      });

      expect(result).toEqual([
        {
          content: 'Chat Instruction\n\nAssistant role\n\nImported system context',
          role: 'system',
        },
        { content: 'User message', role: 'user' },
      ]);
    });

    it('should combine all preprocessing steps correctly', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Old message 1',
          createdAt: Date.now(),
          id: 'test-old-1',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'assistant',
          content: 'Old response',
          createdAt: Date.now(),
          id: 'test-old-2',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'Recent input with {{username}}',
          createdAt: Date.now(),
          id: 'test-recent',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'System instructions.',
        inputTemplate: 'Processed: {{text}}',
        enableHistoryCount: true,
        historyCount: 2, // Should keep last 1 message
      });

      // System role should be first
      expect(result).toEqual([
        {
          content: 'System instructions.',
          role: 'system',
        },
        {
          role: 'assistant',
          content: 'Old response',
        },
        {
          content: 'Processed: Recent input with TestUser',
          role: 'user',
        },
      ]);
    });

    it('should skip preprocessing when no configuration is provided', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Simple message',
          createdAt: Date.now(),
          id: 'test-simple',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Should pass message unchanged
      expect(result).toEqual([
        {
          content: 'Simple message',
          role: 'user',
        },
      ]);
    });

    it('should handle history truncation with system role injection correctly', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'Message 1',
          createdAt: Date.now(),
          id: 'test-1',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'Message 2',
          createdAt: Date.now(),
          id: 'test-2',
          meta: {},
          updatedAt: Date.now(),
        },
        {
          role: 'user',
          content: 'Message 3',
          createdAt: Date.now(),
          id: 'test-3',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'System role here.',
        enableHistoryCount: true,
        historyCount: 1, // Should keep only 1 message
      });

      // Should have system role + 1 truncated message
      expect(result).toEqual([
        {
          content: 'System role here.',
          role: 'system',
        },
        {
          content: 'Message 3', // Only the last message should remain
          role: 'user',
        },
      ]);
    });

    it('should handle input template compilation errors gracefully', async () => {
      const messages: UIChatMessage[] = [
        {
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          id: 'test-error',
          meta: {},
          updatedAt: Date.now(),
        },
      ];

      // This should not throw an error, but handle it gracefully
      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        inputTemplate: '<%- invalid javascript syntax %>',
      });

      // Should keep original message when template fails
      expect(result).toEqual([
        {
          content: 'User message',
          role: 'user',
        },
      ]);
    });
  });
});
