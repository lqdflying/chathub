import { render } from '@testing-library/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs } from '@/types/files';

import { useFileCategory } from './useFileCategory';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/knowledge'),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

interface MockState {
  pathname: string;
  search: string;
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
}

const setMockState = ({ pathname, search }: { pathname: string; search: string }): MockState => {
  const push = vi.fn();
  const replace = vi.fn();
  vi.mocked(usePathname).mockReturnValue(pathname);
  vi.mocked(useRouter).mockReturnValue({ push, replace } as any);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(search) as any);
  return { pathname, search, push, replace };
};

const Trigger = ({ value }: { value: string }) => {
  const [, setCategory] = useFileCategory();
  React.useEffect(() => {
    setCategory(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileCategory', () => {
  it('pushes /knowledge?category=<value> from the home route and preserves sibling filters like q', () => {
    const { push, replace } = setMockState({
      pathname: '/knowledge',
      search: 'q=report&category=images',
    });

    render(<Trigger value={FilesTabs.Documents} />);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/knowledge?q=report&category=documents');
    expect(replace).not.toHaveBeenCalled();
  });

  it('navigates to /knowledge from a base-detail route instead of silently rewriting the detail URL', () => {
    const { push } = setMockState({
      pathname: '/knowledge/bases/kb-1',
      search: 'file=file-9',
    });

    render(<Trigger value={FilesTabs.All} />);

    expect(push).toHaveBeenCalledTimes(1);
    // `file` is stripped, `category=All` is deleted → bare /knowledge
    expect(push).toHaveBeenCalledWith('/knowledge');
  });

  it('deletes the category param when switching to FilesTabs.All', () => {
    const { push } = setMockState({ pathname: '/knowledge', search: 'category=documents' });

    render(<Trigger value={FilesTabs.All} />);

    expect(push).toHaveBeenCalledWith('/knowledge');
  });

  it('strips legacy `files` param when switching category', () => {
    const { push } = setMockState({
      pathname: '/knowledge/bases/kb-2',
      search: 'files=f1&category=images',
    });

    render(<Trigger value={FilesTabs.Documents} />);

    expect(push).toHaveBeenCalledWith('/knowledge?category=documents');
  });
});
