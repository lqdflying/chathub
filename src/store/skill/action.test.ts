import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { skillService } from '@/services/skill';
import { useAgentStore } from '@/store/agent';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useSkillStore } from './store';

const mutateAccountSWR = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWR,
}));

vi.mock('@/services/skill', () => ({
  skillService: {
    getInstalledSkills: vi.fn(),
    installSkillFromUrl: vi.fn(),
    uninstallSkill: vi.fn(),
    updateSkill: vi.fn(),
  },
}));

describe('skill store actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAccountSWR.mockResolvedValue(undefined);
    vi.mocked(skillService.getInstalledSkills).mockResolvedValue([]);
    vi.mocked(skillService.installSkillFromUrl).mockResolvedValue('reviewer');
    vi.mocked(skillService.uninstallSkill).mockResolvedValue();
    vi.mocked(skillService.updateSkill).mockResolvedValue();
    useUserStore.setState({ authUserId: undefined, isLoaded: false, user: undefined });
    useSkillStore.setState({
      installedSkills: [],
      isLoading: false,
      selectedSkillIdsByConversation: {},
    });
    useAgentStore.setState({
      agentMap: {},
      defaultAgentConfig: DEFAULT_AGENT_CONFIG,
    });
    useSessionStore.setState({ defaultSessions: [], pinnedSessions: [], sessions: [] });
  });

  it('keeps pending selections isolated by conversation', () => {
    const actions = useSkillStore.getState();

    actions.toggleSelectedSkill('reviewer', true, 'session-a:topic-a:main');
    actions.toggleSelectedSkill('summarizer', true, 'session-b:topic-b:main');
    actions.clearSelectedSkills('session-a:topic-a:main');

    expect(useSkillStore.getState().selectedSkillIdsByConversation).toEqual({
      'session-b:topic-b:main': ['summarizer'],
    });
  });

  it('prunes uninstalled skills from loaded agent and group caches', async () => {
    const groupSession = {
      id: 'group-1',
      members: [
        { id: 'member-1', skills: ['reviewer', 'keep-skill'] },
        { id: 'member-2', skills: ['other-skill'] },
      ],
      type: 'group',
    } as any;
    useAgentStore.setState({
      agentMap: {
        'session-1': { skills: ['reviewer', 'keep-skill'] },
        'session-2': { skills: ['other-skill'] },
      },
      defaultAgentConfig: { ...DEFAULT_AGENT_CONFIG, skills: ['reviewer'] },
    });
    useSessionStore.setState({
      defaultSessions: [groupSession],
      pinnedSessions: [groupSession],
      sessions: [groupSession],
    });

    await useSkillStore.getState().uninstallSkill('reviewer');

    expect(skillService.uninstallSkill).toHaveBeenCalledWith('reviewer');
    expect(mutateAccountSWR).toHaveBeenCalledWith(['installed-skills', 'local']);
    expect(useAgentStore.getState().agentMap['session-1'].skills).toEqual(['keep-skill']);
    expect(useAgentStore.getState().agentMap['session-2'].skills).toEqual(['other-skill']);
    expect(useAgentStore.getState().defaultAgentConfig.skills).toEqual([]);
    for (const key of ['defaultSessions', 'pinnedSessions', 'sessions'] as const) {
      const members = (useSessionStore.getState()[key][0] as any).members;
      expect(members[0].skills).toEqual(['keep-skill']);
      expect(members[1].skills).toEqual(['other-skill']);
    }
  });

  it('installs a skill from URL and revalidates the installed-skills cache', async () => {
    const params = {
      sourceType: 'url' as const,
      sourceUrl: 'https://example.com/SKILL.md',
    };

    await useSkillStore.getState().installSkillFromUrl(params);

    expect(skillService.installSkillFromUrl).toHaveBeenCalledWith(params);
    expect(mutateAccountSWR).toHaveBeenCalledWith(['installed-skills', 'local']);
  });

  it('updates a skill and revalidates the installed-skills cache', async () => {
    const params = {
      description: 'Updated description.',
      identifier: 'reviewer',
      instructions: 'Updated instructions.',
    };

    await useSkillStore.getState().updateSkill(params);

    expect(skillService.updateSkill).toHaveBeenCalledWith(params);
    expect(mutateAccountSWR).toHaveBeenCalledWith(['installed-skills', 'local']);
  });
});
