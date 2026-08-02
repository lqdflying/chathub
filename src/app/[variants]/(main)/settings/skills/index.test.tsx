import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SkillsManagement from './index';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  installSkillFromUrl: vi.fn(),
  searchInputProps: undefined as any,
  searchRegistry: vi.fn(),
  uninstallSkill: vi.fn(),
  useFetchSkills: vi.fn(),
}));

const appContext = vi.hoisted(() => ({
  message: { error: vi.fn() },
  modal: { confirm: vi.fn() },
}));

vi.mock('@lobehub/ui', () => {
  const Empty = Object.assign(() => null, { PRESENTED_IMAGE_SIMPLE: 'simple' });

  return {
    Button: ({ children }: { children?: React.ReactNode }) => children ?? null,
    DraggablePanel: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Empty,
    Input: (props: any) => {
      if (props.placeholder === 'skills.search') mocks.searchInputProps = props;
      return null;
    },
  };
});

vi.mock('antd', () => {
  const Form = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Item: ({ children }: { children?: React.ReactNode }) => children ?? null },
  );

  return {
    App: {
      useApp: () => appContext,
    },
    Form,
    Modal: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Tag: ({ children }: { children?: React.ReactNode }) => children ?? null,
  };
});

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: { detail: '' } }),
  useTheme: () => ({ colorBgContainerSecondary: '#fff', colorBorderSecondary: '#ddd' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Flexbox: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock('@/services/skill', () => ({
  skillService: { searchRegistry: mocks.searchRegistry },
}));

vi.mock('@/store/skill', () => {
  const state = {
    installSkillFromUrl: mocks.installSkillFromUrl,
    installedSkills: [],
    uninstallSkill: mocks.uninstallSkill,
    useFetchSkills: mocks.useFetchSkills,
  };

  return { useSkillStore: (selector: (state: typeof state) => unknown) => selector(state) };
});

describe('SkillsManagement registry search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.searchInputProps = undefined;
    mocks.searchRegistry.mockResolvedValue({ configured: true, items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces registry searches and cancels the stale query', async () => {
    render(<SkillsManagement />);

    act(() => mocks.searchInputProps.onChange({ target: { value: 're' } }));
    await act(() => vi.advanceTimersByTimeAsync(200));
    act(() => mocks.searchInputProps.onChange({ target: { value: 'review' } }));
    await act(() => vi.advanceTimersByTimeAsync(299));

    expect(mocks.searchRegistry).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(mocks.searchRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.searchRegistry).toHaveBeenCalledWith('review');
  });
});
