import { renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enableSkills: true, enableSTT: true, hideDocs: false, showLLM: true },
  isMobile: false,
}));

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
    featureFlags: {
      enableSkills: boolean;
      enableSTT: boolean;
      hideDocs: boolean;
      showLLM: boolean;
    };
  }) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

describe('desktop settings categories', () => {
  beforeEach(() => {
    serverConfigState.featureFlags.enableSkills = true;
  });

  it('does not expose the retired Image settings destination', () => {
    const { result } = renderHook(() => useCategory());

    expect(result.current.some((item) => item && 'key' in item && item.key === 'image')).toBe(
      false,
    );
  });

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

  it('hides Skills when the feature is disabled', () => {
    serverConfigState.featureFlags.enableSkills = false;

    const { result } = renderHook(() => useCategory());

    expect(
      result.current.some((item) => item && 'key' in item && item.key === SettingsTabs.Skills),
    ).toBe(false);
  });
});
