import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageStore } from '@/store/image';

import TopicUrlSync from './TopicUrlSync';

const queryState = vi.hoisted(() => ({
  setTopic: vi.fn(),
  topic: null as string | null,
}));

vi.mock('nuqs', () => ({
  useQueryState: () => [queryState.topic, queryState.setTopic],
}));

describe('TopicUrlSync', () => {
  beforeEach(() => {
    queryState.setTopic.mockReset();
    queryState.topic = null;
    useImageStore.setState({ activeGenerationTopicId: null });
  });

  it('hydrates the active store topic from a direct URL', async () => {
    queryState.topic = 'topic-from-url';

    render(<TopicUrlSync />);

    await waitFor(() => {
      expect(useImageStore.getState().activeGenerationTopicId).toBe('topic-from-url');
    });
  });

  it('publishes a newly active store topic while the topic drawer is closed', () => {
    render(<TopicUrlSync />);

    act(() => {
      useImageStore.setState({ activeGenerationTopicId: 'new-mobile-topic' });
    });

    expect(queryState.setTopic).toHaveBeenCalledWith('new-mobile-topic');
  });
});
