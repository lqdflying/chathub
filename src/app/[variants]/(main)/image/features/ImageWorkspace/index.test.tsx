import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ImageWorkspace from './index';

const useFetchAiImageConfig = vi.hoisted(() => vi.fn());

vi.mock('nuqs', () => ({
  useQueryState: () => [null],
}));

vi.mock('@/hooks/useFetchAiImageConfig', () => ({
  useFetchAiImageConfig,
}));

vi.mock('@/store/image', () => ({
  useImageStore: (selector: (state: { isCreatingWithNewTopic: boolean }) => unknown) =>
    selector({ isCreatingWithNewTopic: false }),
}));

vi.mock('./Content', () => ({
  default: () => <div>Image content</div>,
}));

vi.mock('./EmptyState', () => ({
  default: () => <div>Empty image workspace</div>,
}));

describe('ImageWorkspace', () => {
  it('initializes image configuration while rendering the workspace', () => {
    render(<ImageWorkspace />);

    expect(useFetchAiImageConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Empty image workspace')).toBeTruthy();
  });
});
