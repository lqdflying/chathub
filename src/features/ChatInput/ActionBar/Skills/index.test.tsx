import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Skills from './index';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enableSkills: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentSkills: () => ['reviewer'] },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/skill', () => ({
  useSkillStore: (selector: (state: object) => unknown) =>
    selector({
      installedSkills: [{ identifier: 'reviewer' }],
      isLoading: false,
    }),
}));

vi.mock('../components/Action', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('./useControls', () => ({ useControls: () => [] }));

describe('ChatInput Skills action feature gate', () => {
  beforeEach(() => {
    serverConfigState.featureFlags.enableSkills = true;
  });

  it('renders when enabled skills are available', () => {
    render(<Skills />);

    expect(screen.getByText('skills.title')).toBeTruthy();
  });

  it('renders nothing when the feature is disabled', () => {
    serverConfigState.featureFlags.enableSkills = false;

    render(<Skills />);

    expect(screen.queryByText('skills.title')).toBeNull();
  });
});
