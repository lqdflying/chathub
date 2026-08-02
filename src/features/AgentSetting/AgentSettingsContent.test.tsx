import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import AgentSettingsContent from './AgentSettingsContent';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enablePlugins: true, enableSkills: true },
}));

vi.mock('@/features/AgentSetting/store', () => ({
  useStore: (selector: (state: { loading: boolean }) => unknown) => selector({ loading: false }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('./AgentChat', () => ({ default: () => <div>AgentChat</div> }));
vi.mock('./AgentMemory', () => ({ default: () => <div>AgentMemory</div> }));
vi.mock('./AgentMeta', () => ({ default: () => <div>AgentMeta</div> }));
vi.mock('./AgentModal', () => ({ default: () => <div>AgentModal</div> }));
vi.mock('./AgentOpening', () => ({ default: () => <div>AgentOpening</div> }));
vi.mock('./AgentPlugin', () => ({ default: () => <div>AgentPlugin</div> }));
vi.mock('./AgentPrompt', () => ({ default: () => <div>AgentPrompt</div> }));
vi.mock('./AgentTTS', () => ({ default: () => <div>AgentTTS</div> }));

describe('AgentSettingsContent removed Skills tab', () => {
  it('does not render content for a legacy Skills tab value', () => {
    const { container } = render(
      <AgentSettingsContent loadingSkeleton={null} tab={'skills' as ChatSettingsTabs} />,
    );

    expect(container.textContent).toBe('');
  });
});
