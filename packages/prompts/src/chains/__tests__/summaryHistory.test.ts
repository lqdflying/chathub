import { UIChatMessage } from '@lobechat/types';
import { Mock, describe, expect, it, vi } from 'vitest';

import { chainSummaryHistory } from '../summaryHistory';

describe('chainSummaryHistory', () => {
  it('should use the default model if the token count is below the GPT-3.5 limit', async () => {
    // Arrange
    const messages = [
      { content: 'Hello, how can I assist you?', role: 'assistant' },
      { content: 'I need help with my account.', role: 'user' },
    ] as UIChatMessage[];

    // Act
    const result = chainSummaryHistory(messages);

    // Assert
    expect(result).toMatchSnapshot();
  });

  it('includes the existing summary for incremental compaction', () => {
    const messages = [
      { content: 'Use port 3010.', role: 'user' },
      { content: 'Noted.', role: 'assistant' },
    ] as UIChatMessage[];

    const result = chainSummaryHistory(messages, 'The project uses Bun.');

    expect(result.messages?.[1].content).toContain(
      '<existing_summary>\nThe project uses Bun.\n</existing_summary>',
    );
    expect(result.messages?.[1].content).toContain('Use port 3010.');
    expect(result.messages?.[0].content).toContain('limited to 400 tokens');
  });
});
