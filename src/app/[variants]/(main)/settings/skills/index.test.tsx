import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SkillsManagement from './index';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  installSkill: vi.fn(),
  installSkillFromUrl: vi.fn(),
  parseSkillArchive: vi.fn(),
  registryButtonProps: undefined as any,
  searchInputProps: undefined as any,
  searchRegistry: vi.fn(),
  translate: vi.fn((key: string) => key),
  uninstallSkill: vi.fn(),
  uploadProps: undefined as any,
  useFetchSkills: vi.fn(),
}));

const appContext = vi.hoisted(() => ({
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  modal: { confirm: vi.fn() },
}));

vi.mock('@lobehub/ui', () => {
  const Empty = Object.assign(() => null, { PRESENTED_IMAGE_SIMPLE: 'simple' });

  return {
    Button: (props: any) => {
      if (props.type === 'text') mocks.registryButtonProps = props;
      return (
        <button disabled={props.disabled} onClick={props.onClick}>
          {props.children}
        </button>
      );
    },
    DraggablePanel: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Empty,
    Input: (props: any) => {
      if (props.placeholder === 'skills.search') mocks.searchInputProps = props;
      return null;
    },
  };
});

vi.mock('antd', () => {
  const Form = Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
    Item: ({ children }: { children?: React.ReactNode }) => children ?? null,
  });

  return {
    App: {
      useApp: () => appContext,
    },
    Form,
    Modal: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Segmented: () => null,
    Tag: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Upload: {
      Dragger: (props: any) => {
        mocks.uploadProps = props;
        return props.children ?? null;
      },
    },
  };
});

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: { detail: '' } }),
  useTheme: () => ({ colorBgContainerSecondary: '#fff', colorBorderSecondary: '#ddd' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Flexbox: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock('@/services/skill', () => ({
  skillService: { searchRegistry: mocks.searchRegistry },
}));

vi.mock('@/services/skill/archive', () => ({
  parseSkillArchive: mocks.parseSkillArchive,
}));

vi.mock('@/store/skill', () => {
  const state = {
    installSkill: mocks.installSkill,
    installSkillFromUrl: mocks.installSkillFromUrl,
    installedSkills: [],
    uninstallSkill: mocks.uninstallSkill,
    useFetchSkills: mocks.useFetchSkills,
  };

  return { useSkillStore: (selector: (state: typeof state) => unknown) => selector(state) };
});

describe('SkillsManagement registry search', () => {
  const registryItem = {
    description: 'Review changes',
    identifier: 'reviewer',
    name: 'Reviewer',
    sourceRef: 'main',
    sourceType: 'registry' as const,
    sourceUrl: 'https://example.com/SKILL.md',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.searchInputProps = undefined;
    mocks.uploadProps = undefined;
    mocks.installSkill.mockResolvedValue(undefined);
    mocks.parseSkillArchive.mockResolvedValue({
      bundledResourceCount: 2,
      identifier: 'reviewer',
      instructions: 'skill instructions',
    });
    mocks.registryButtonProps = undefined;
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

  it('disables registry installs while pending and reports success', async () => {
    let resolveInstall!: () => void;
    const installRequest = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });
    mocks.installSkillFromUrl.mockReturnValue(installRequest);
    mocks.searchRegistry.mockResolvedValue({ configured: true, items: [registryItem] });
    render(<SkillsManagement />);

    act(() => mocks.searchInputProps.onChange({ target: { value: 'review' } }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    let clickRequest!: Promise<void>;
    act(() => {
      clickRequest = mocks.registryButtonProps.onClick();
    });

    expect(mocks.installSkillFromUrl).toHaveBeenCalledWith({
      expectedIdentifier: 'reviewer',
      sourceRef: 'main',
      sourceType: 'registry',
      sourceUrl: 'https://example.com/SKILL.md',
    });
    expect(mocks.registryButtonProps.disabled).toBe(true);

    await act(async () => {
      resolveInstall();
      await clickRequest;
    });

    expect(appContext.message.success).toHaveBeenCalledWith('skills.installSuccess');
    expect(mocks.registryButtonProps.disabled).toBe(false);
  });

  it('re-enables registry installs and reports an error after failure', async () => {
    mocks.installSkillFromUrl.mockRejectedValue(new Error('Install failed'));
    mocks.searchRegistry.mockResolvedValue({ configured: true, items: [registryItem] });
    render(<SkillsManagement />);

    act(() => mocks.searchInputProps.onChange({ target: { value: 'review' } }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    await act(() => mocks.registryButtonProps.onClick());

    expect(appContext.message.error).toHaveBeenCalledWith('Install failed');
    expect(mocks.registryButtonProps.disabled).toBe(false);
  });

  it('installs a local .skill file and warns when bundled resources are skipped', async () => {
    render(<SkillsManagement mobile />);
    const file = new File(['archive'], 'reviewer.skill');

    await act(() => mocks.uploadProps.beforeUpload(file));

    expect(mocks.parseSkillArchive).toHaveBeenCalledWith(file);
    expect(mocks.installSkill).toHaveBeenCalledWith({
      instructions: 'skill instructions',
      sourceRef: 'reviewer.skill',
      sourceType: 'file',
    });
    expect(mocks.translate).toHaveBeenCalledWith('skills.resourcesSkipped', {
      name: 'reviewer',
      skipped: 2,
    });
    expect(appContext.message.warning).toHaveBeenCalledWith('skills.resourcesSkipped');
  });
});
