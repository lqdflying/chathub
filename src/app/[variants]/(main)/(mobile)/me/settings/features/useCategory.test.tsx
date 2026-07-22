import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

const routerPush = vi.fn();

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
  featureFlagsSelectors: (state: { featureFlags: { showLLM: boolean } }) => state.featureFlags,
  useServerConfigStore: (selector: (state: { featureFlags: { showLLM: boolean } }) => unknown) =>
    selector({ featureFlags: { showLLM: true } }),
}));

describe('mobile settings categories', () => {
  beforeEach(() => {
    routerPush.mockReset();
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
});
