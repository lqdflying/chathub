import { describe, expect, it } from 'vitest';

import { HistoryTruncateProcessor, getSlicedMessages } from '../HistoryTruncate';

describe('HistoryTruncateProcessor', () => {
  describe('getSlicedMessages', () => {
    const messages = [
      { id: '1', content: 'First', role: 'user' },
      { id: '2', content: 'Second', role: 'assistant' },
      { id: '3', content: 'Third', role: 'user' },
      { id: '4', content: 'Fourth', role: 'assistant' },
      { id: '5', content: 'Fifth', role: 'user' },
    ];

    it('should return all messages when history count is disabled', () => {
      const result = getSlicedMessages(messages, { enableHistoryCount: false });
      expect(result).toEqual(messages);
    });

    it('should return all messages when historyCount is undefined', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: undefined,
      });
      expect(result).toEqual(messages);
    });

    it('should return last N messages based on historyCount', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 2,
      });
      expect(result).toEqual([
        { id: '4', content: 'Fourth', role: 'assistant' },
        { id: '5', content: 'Fifth', role: 'user' },
      ]);
    });

    it('should count the latest user message within historyCount', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 3,
      });

      expect(result).toEqual([
        { id: '3', content: 'Third', role: 'user' },
        { id: '4', content: 'Fourth', role: 'assistant' },
        { id: '5', content: 'Fifth', role: 'user' },
      ]);
    });

    it('should preserve the complete active tool turn without sliding the cached prefix', () => {
      const initialMessages = [
        { id: 'old-user', content: 'Old question', role: 'user' },
        { id: 'old-assistant', content: 'Old answer', role: 'assistant' },
        { id: 'latest-user', content: 'Search for this', role: 'user' },
      ];
      const toolContinuation = [
        ...initialMessages,
        { id: 'tool-assistant', content: '', role: 'assistant' },
        { id: 'tool-1', content: 'First result', role: 'tool' },
        { id: 'tool-2', content: 'Second result', role: 'tool' },
        { id: 'tool-3', content: 'Third result', role: 'tool' },
      ];
      const options = { enableHistoryCount: true, historyCount: 2 };

      const initialWindow = getSlicedMessages(initialMessages, options);
      const continuationWindow = getSlicedMessages(toolContinuation, options);

      expect(initialWindow.map(({ id }) => id)).toEqual(['old-assistant', 'latest-user']);
      expect(continuationWindow.slice(0, initialWindow.length)).toEqual(initialWindow);
      expect(continuationWindow.map(({ id }) => id)).toEqual([
        'old-assistant',
        'latest-user',
        'tool-assistant',
        'tool-1',
        'tool-2',
        'tool-3',
      ]);
    });

    it('should re-anchor the history window when a new user turn starts', () => {
      const messagesWithNewTurn = [
        { id: 'old-user', content: 'Old question', role: 'user' },
        { id: 'old-assistant', content: 'Old answer', role: 'assistant' },
        { id: 'tool-user', content: 'Search for this', role: 'user' },
        { id: 'tool-assistant', content: '', role: 'assistant' },
        { id: 'tool-result', content: 'Search result', role: 'tool' },
        { id: 'final-assistant', content: 'Final answer', role: 'assistant' },
        { id: 'new-user', content: 'Next question', role: 'user' },
      ];

      const result = getSlicedMessages(messagesWithNewTurn, {
        enableHistoryCount: true,
        historyCount: 2,
      });

      expect(result.map(({ id }) => id)).toEqual(['final-assistant', 'new-user']);
    });

    it('should keep the legacy last-N behavior when there is no user message', () => {
      const assistantOnlyMessages = [
        { id: '1', content: 'First', role: 'assistant' },
        { id: '2', content: 'Second', role: 'assistant' },
        { id: '3', content: 'Third', role: 'assistant' },
      ];

      const result = getSlicedMessages(assistantOnlyMessages, {
        enableHistoryCount: true,
        historyCount: 2,
      });

      expect(result.map(({ id }) => id)).toEqual(['2', '3']);
    });

    it('should return empty array when historyCount is 0', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 0,
      });
      expect(result).toEqual([]);
    });

    it('should return empty array when historyCount is negative', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: -1,
      });
      expect(result).toEqual([]);
    });

    it('should return all messages when historyCount exceeds array length', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 10,
      });
      expect(result).toEqual(messages);
    });

    it('should handle empty message array', () => {
      const result = getSlicedMessages([], {
        enableHistoryCount: true,
        historyCount: 2,
      });
      expect(result).toEqual([]);
    });
  });

  describe('HistoryTruncateProcessor', () => {
    it('should truncate messages based on configuration', async () => {
      const processor = new HistoryTruncateProcessor({
        enableHistoryCount: true,
        historyCount: 3,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          { id: '1', content: 'First', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '2',
            content: 'Second',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          { id: '3', content: 'Third', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '4',
            content: 'Fourth',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          { id: '5', content: 'Fifth', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
      };

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(3); // 2 + 1 for new user message
      expect(result.messages).toEqual([
        expect.objectContaining({ content: 'Third' }),
        expect.objectContaining({ content: 'Fourth' }),
        expect.objectContaining({ content: 'Fifth' }),
      ]);
      expect(result.metadata.historyTruncated).toBe(2);
      expect(result.metadata.finalMessageCount).toBe(3);
    });

    it('should not truncate when history count is disabled', async () => {
      const processor = new HistoryTruncateProcessor({
        enableHistoryCount: false,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          { id: '1', content: 'First', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '2',
            content: 'Second',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
      };

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.metadata.historyTruncated).toBe(0);
      expect(result.metadata.finalMessageCount).toBe(2);
    });
  });
});
