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

    it('should keep the newest continuation messages when the tail exceeds maxContinuationMessages', () => {
      const messagesWithLongTail = [
        { id: 'old-assistant', content: 'Old answer', role: 'assistant' },
        { id: 'latest-user', content: 'Search for this', role: 'user' },
        { id: 'a1', content: '', role: 'assistant' },
        { id: 't1', content: 'Result 1', role: 'tool' },
        { id: 't2', content: 'Result 2', role: 'tool' },
        { id: 'a2', content: '', role: 'assistant' },
        { id: 't3', content: 'Result 3', role: 'tool' },
        { id: 't4', content: 'Result 4', role: 'tool' },
      ];

      const result = getSlicedMessages(messagesWithLongTail, {
        enableHistoryCount: true,
        historyCount: 2,
        maxContinuationMessages: 3,
      });

      expect(result.map(({ id }) => id)).toEqual([
        'old-assistant',
        'latest-user',
        'a2',
        't3',
        't4',
      ]);
    });

    it('should always include the newest tool result so a capped loop can progress', () => {
      const base = [
        { id: 'latest-user', content: 'Do the task', role: 'user' },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `tail-${i}`,
          content: `Step ${i}`,
          role: i % 2 === 0 ? 'assistant' : 'tool',
        })),
      ];
      const grown = [...base, { id: 'tail-new', content: 'Newest result', role: 'tool' }];
      const options = { enableHistoryCount: true, historyCount: 1, maxContinuationMessages: 3 };

      const firstWindow = getSlicedMessages(base, options);
      const secondWindow = getSlicedMessages(grown, options);

      expect(secondWindow.at(-1)?.id).toBe('tail-new');
      // consecutive rounds must not produce identical prompts, or the loop can never progress
      expect(secondWindow.map(({ id }) => id)).not.toEqual(firstWindow.map(({ id }) => id));
    });

    it('should cap the continuation tail to the latest 20 messages by default', () => {
      const longTail = [
        { id: 'latest-user', content: 'Go', role: 'user' },
        ...Array.from({ length: 25 }, (_, i) => ({
          id: `c-${i}`,
          content: `Continuation ${i}`,
          role: i % 2 === 0 ? 'assistant' : 'tool',
        })),
      ];

      const result = getSlicedMessages(longTail, {
        enableHistoryCount: true,
        historyCount: 5,
      });

      expect(result).toHaveLength(21); // latest user message + last 20 continuation messages
      expect(result[0].id).toBe('latest-user');
      expect(result[1].id).toBe('c-5');
      expect(result.at(-1)?.id).toBe('c-24');
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
