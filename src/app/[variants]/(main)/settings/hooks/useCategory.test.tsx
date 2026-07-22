import { renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: {
    featureFlags: { enableSTT: boolean; hideDocs: boolean; showLLM: boolean };
  }) => state.featureFlags,
  useServerConfigStore: (
    selector: (state: {
      featureFlags: { enableSTT: boolean; hideDocs: boolean; showLLM: boolean };
      isMobile: boolean;
    }) => unknown,
  ) =>
    selector({
      featureFlags: { enableSTT: true, hideDocs: false, showLLM: true },
      isMobile: false,
    }),
}));

describe('desktop settings categories', () => {
  it('exposes Chat Instruction as a top-level destination', () => {
    const { result } = renderHook(() => useCategory());

    expect(result.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: SettingsTabs.ChatInstruction,
          label: 'tab.chat-instruction',
        }),
      ]),
    );
  });
});
