import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { AssistantMessageContent } from './MessageContent';

vi.stubGlobal('React', React);

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../Default', () => ({
  DefaultMessage: () => <div data-testid="default-message" />,
}));

vi.mock('./Tool', () => ({
  default: () => <div data-testid="tool-card" />,
}));

vi.mock('./FileChunks', () => ({ default: () => null }));
vi.mock('./Reasoning', () => ({ default: () => null }));
vi.mock('./SearchGrounding', () => ({ default: () => null }));
vi.mock('../User/ImageFileListViewer', () => ({ default: () => null }));
vi.mock('@/components/CircleLoader', () => ({
  default: () => <div data-testid="circle-loader" />,
}));

const ASSISTANT_ID = 'assistant-planning';
const SESSION_ID = 'session-1';
const TOPIC_ID = 'topic-1';

const baseMeta = { avatar: '', backgroundColor: '', description: '', tags: [], title: '' };

const renderContent = (overrides: Partial<React.ComponentProps<typeof AssistantMessageContent>> = {}) =>
  render(
    <AssistantMessageContent
      content={LOADING_FLAT}
      createdAt={Date.now()}
      editableContent={<div>editable</div>}
      id={ASSISTANT_ID}
      meta={baseMeta}
      role="assistant"
      updatedAt={Date.now()}
      {...overrides}
    />,
  );

describe('AssistantMessageContent planning status', () => {
  beforeEach(() => {
    useChatStore.setState({
      chatLoadingIds: [],
      messageEditingIds: [],
      messageRAGLoadingIds: [],
      messagesMap: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: [
          { content: LOADING_FLAT, id: ASSISTANT_ID, role: 'assistant' },
        ],
      },
      searchWorkflowLoadingIds: [],
      serverGenerationOperations: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: {
          cgo_one: {
            assistantMessageId: ASSISTANT_ID,
            generation: 0,
            kind: 'chat',
            lane: 'lane-main',
            operationId: 'cgo_one',
            phase: 'planning',
            sessionId: SESSION_ID,
            topicId: TOPIC_ID,
            userScope: 'current',
          },
        },
      },
    });
  });

  afterEach(() => {
    useChatStore.setState({
      chatLoadingIds: [],
      messageEditingIds: [],
      messageRAGLoadingIds: [],
      messagesMap: {},
      searchWorkflowLoadingIds: [],
      serverGenerationOperations: {},
    });
  });

  it('shows planning copy instead of unlabeled bubbles', () => {
    renderContent();
    expect(screen.getByText('planningNextStep.title')).toBeTruthy();
    expect(screen.queryByTestId('default-message')).toBeNull();
  });

  it('keeps search-workflow copy instead of planning', () => {
    useChatStore.setState({ searchWorkflowLoadingIds: [ASSISTANT_ID] });
    renderContent();
    expect(screen.getByText('intentUnderstanding.title')).toBeTruthy();
    expect(screen.queryByText('planningNextStep.title')).toBeNull();
  });

  it('shows a static tool-cap row after the budget is exhausted', () => {
    useChatStore.setState({
      messagesMap: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: [
          {
            content: 'calling tool',
            id: ASSISTANT_ID,
            metadata: { conversationGenerationStopReason: 'tool_cap' },
            role: 'assistant',
            tools: [{ apiName: 'search', id: 'call-1', identifier: 'plugin', type: 'default' }],
          },
        ],
      },
      serverGenerationOperations: {},
    });

    renderContent({
      content: 'calling tool',
      tools: [{ apiName: 'search', id: 'call-1', identifier: 'plugin', type: 'default' }],
    });

    expect(screen.getByText('planningNextStep.toolCap')).toBeTruthy();
    expect(screen.queryByTestId('circle-loader')).toBeNull();
    expect(screen.getByTestId('tool-card')).toBeTruthy();
  });
});
