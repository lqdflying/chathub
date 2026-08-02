import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Skills from './index';

vi.stubGlobal('React', React);

const serverConfigState = vi.hoisted(() => ({
  featureFlags: { enableSkills: true },
}));
const skillContext = vi.hoisted(() => ({
  activeSessionType: 'agent' as 'agent' | 'group',
  agentSkillIds: ['reviewer'],
  groupSkillIds: ['group-reviewer'],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentSkills: () => skillContext.agentSkillIds },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof skillContext) => unknown) => selector(skillContext),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof serverConfigState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof serverConfigState) => unknown) =>
    selector(serverConfigState),
}));

vi.mock('@/store/skill', () => ({
  useSkillStore: (selector: (state: object) => unknown) =>
    selector({
      installedSkills: [{ identifier: 'reviewer' }, { identifier: 'group-reviewer' }],
      isLoading: false,
    }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: typeof skillContext) => unknown) => selector(skillContext),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: {
    currentGroupAgents: () => [{ skills: skillContext.groupSkillIds }],
  },
}));

vi.mock('../components/Action', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('./useControls', () => ({ useControls: () => [] }));

describe('ChatInput Skills action feature gate', () => {
  beforeEach(() => {
    serverConfigState.featureFlags.enableSkills = true;
    skillContext.activeSessionType = 'agent';
    skillContext.agentSkillIds = ['reviewer'];
    skillContext.groupSkillIds = ['group-reviewer'];
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

  it('renders for a group skill even when the current agent has no skills', () => {
    skillContext.activeSessionType = 'group';
    skillContext.agentSkillIds = [];

    render(<Skills />);

    expect(screen.getByText('skills.title')).toBeTruthy();
  });
});
