import { renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import { useCategory } from './useCategory';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enablePlugins: true, enableSkills: true },
}));

vi.mock('@lobehub/ui', () => ({ Icon: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId: string }) => unknown) =>
    selector({ activeId: 'agent-1' }),
}));

describe('agent settings categories', () => {
  beforeEach(() => {
    serverConfigState.featureFlags.enableSkills = true;
  });

  it('includes Skills when the feature is enabled', () => {
    const { result } = renderHook(() => useCategory());

    expect(result.current).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: ChatSettingsTabs.Skills })]),
    );
  });

  it('hides Skills when the feature is disabled', () => {
    serverConfigState.featureFlags.enableSkills = false;

    const { result } = renderHook(() => useCategory());

    expect(result.current).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: ChatSettingsTabs.Skills })]),
    );
  });
});
