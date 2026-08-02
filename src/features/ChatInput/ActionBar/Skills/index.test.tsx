import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Skills from './index';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enableSkills: true },
}));
const skillContext = vi.hoisted(() => ({
  installedSkills: [{ identifier: 'reviewer' }],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/skill', () => ({
  useSkillStore: (selector: (state: object) => unknown) =>
    selector({
      installedSkills: skillContext.installedSkills,
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
    skillContext.installedSkills = [{ identifier: 'reviewer' }];
  });

  it('renders when a global skill is installed', () => {
    render(<Skills />);

    expect(screen.getByText('skills.title')).toBeTruthy();
  });

  it('renders nothing when the feature is disabled', () => {
    serverConfigState.featureFlags.enableSkills = false;

    render(<Skills />);

    expect(screen.queryByText('skills.title')).toBeNull();
  });

  it('renders nothing when no global skill is installed', () => {
    skillContext.installedSkills = [];

    render(<Skills />);

    expect(screen.queryByText('skills.title')).toBeNull();
  });
});
