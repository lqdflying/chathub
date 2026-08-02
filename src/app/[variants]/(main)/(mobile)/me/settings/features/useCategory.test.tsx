import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

const routerPush = vi.fn();
const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enableSkills: true, showLLM: true },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

describe('mobile settings categories', () => {
  beforeEach(() => {
    routerPush.mockReset();
    serverConfigState.featureFlags.enableSkills = true;
  });

  it('routes the Chat Instruction destination to its settings tab', () => {
    const { result } = renderHook(() => useCategory());
    const chatInstructionItem = result.current.find(
      (item) => item.key === SettingsTabs.ChatInstruction,
    );

    expect(chatInstructionItem).toEqual(
      expect.objectContaining({
        label: 'tab.chat-instruction',
      }),
    );

    act(() => {
      chatInstructionItem?.onClick?.();
    });

    expect(routerPush).toHaveBeenCalledWith('/settings?active=chat-instruction');
  });

  it('routes the Skills destination when the feature is enabled', () => {
    const { result } = renderHook(() => useCategory());
    const skillsItem = result.current.find((item) => item.key === SettingsTabs.Skills);

    expect(skillsItem).toEqual(expect.objectContaining({ label: 'tab.skills' }));

    act(() => {
      skillsItem?.onClick?.();
    });

    expect(routerPush).toHaveBeenCalledWith('/settings?active=skills');
  });

  it('hides the Skills destination when the feature is disabled', () => {
    serverConfigState.featureFlags.enableSkills = false;

    const { result } = renderHook(() => useCategory());

    expect(result.current.some((item) => item.key === SettingsTabs.Skills)).toBe(false);
  });
});
