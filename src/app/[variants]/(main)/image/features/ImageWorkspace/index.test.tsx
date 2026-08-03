import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImageWorkspace from './index';

const useFetchAiImageConfig = vi.hoisted(() => vi.fn());
const queryState = vi.hoisted(() => ({ topic: null as string | null }));

vi.mock('nuqs', () => ({
  useQueryState: () => [queryState.topic],
}));

vi.mock('@/hooks/useFetchAiImageConfig', () => ({
  useFetchAiImageConfig,
}));

vi.mock('./Content', () => ({
  default: () => <div>Image content</div>,
}));

vi.mock('./EmptyState', () => ({
  default: () => <div>Empty image workspace</div>,
}));

describe('ImageWorkspace', () => {
  beforeEach(() => {
    queryState.topic = null;
    useFetchAiImageConfig.mockClear();
  });

  it('initializes image configuration while rendering the workspace', () => {
    render(<ImageWorkspace />);

    expect(useFetchAiImageConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Empty image workspace')).toBeTruthy();
  });

  it('renders topic content as soon as a topic is present', () => {
    queryState.topic = 'topic-1';

    render(<ImageWorkspace />);

    expect(screen.getByText('Image content')).toBeTruthy();
    expect(screen.queryByText('Empty image workspace')).toBeNull();
  });
});
