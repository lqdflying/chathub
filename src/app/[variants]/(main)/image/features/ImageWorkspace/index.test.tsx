import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageStore } from '@/store/image';

import ImageWorkspace from './index';

const useFetchAiImageConfig = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useFetchAiImageConfig', () => ({
  useFetchAiImageConfig,
}));

vi.mock('./Content', () => ({
  default: () => <div>Image content</div>,
}));

vi.mock('./EmptyState', () => ({
  default: () => <div>Empty image workspace</div>,
}));

vi.mock('./TopicUrlSync', () => ({
  default: () => <div data-testid="topic-url-sync" />,
}));

describe('ImageWorkspace', () => {
  beforeEach(() => {
    useFetchAiImageConfig.mockClear();
    useImageStore.setState({ activeGenerationTopicId: null });
  });

  it('initializes image configuration and topic synchronization in the empty workspace', () => {
    render(<ImageWorkspace />);

    expect(useFetchAiImageConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('topic-url-sync')).toBeTruthy();
    expect(screen.getByText('Empty image workspace')).toBeTruthy();
  });

  it('renders topic content when the active store topic changes without a URL update', () => {
    render(<ImageWorkspace />);

    act(() => {
      useImageStore.setState({ activeGenerationTopicId: 'topic-1' });
    });

    expect(screen.getByText('Image content')).toBeTruthy();
    expect(screen.queryByText('Empty image workspace')).toBeNull();
  });
});
