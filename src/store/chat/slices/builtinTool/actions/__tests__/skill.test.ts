import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skillService } from '@/services/skill';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { sessionSelectors } from '@/store/session/selectors';

vi.mock('@/services/skill', () => ({
  skillService: { getSkill: vi.fn() },
}));

describe('skill loader action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(() => () => undefined);
    vi.spyOn(agentSelectors, 'currentAgentSkills').mockReturnValue(['reviewer']);
    vi.spyOn(sessionSelectors, 'currentGroupAgents').mockReturnValue([]);
    useChatStore.setState({
      internal_updateMessageContent: vi.fn(),
      internal_updatePluginError: vi.fn(),
    });
  });

  it('loads the full body only after an enabled skill is requested', async () => {
    vi.mocked(skillService.getSkill).mockResolvedValue({
      contentHash: 'hash-reviewer',
      createdAt: new Date(0),
      description: 'Review code.',
      identifier: 'reviewer',
      instructions: 'Inspect correctness and tests.',
      name: 'reviewer',
      sourceType: 'url',
      updatedAt: new Date(0),
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.load_skill('tool-message', { name: 'reviewer' });
    });

    expect(skillService.getSkill).toHaveBeenCalledWith('reviewer');
    expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
      'tool-message',
      JSON.stringify({
        contentHash: 'hash-reviewer',
        identifier: 'reviewer',
        instructions: 'Inspect correctness and tests.',
        name: 'reviewer',
      }),
    );
  });

  it('rejects a skill that is not enabled without reading its body', async () => {
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.load_skill('tool-message', { name: 'summarizer' });
    });

    expect(skillService.getSkill).not.toHaveBeenCalled();
    expect(result.current.internal_updatePluginError).toHaveBeenCalledWith('tool-message', {
      message: 'The requested skill is not enabled for this assistant.',
      type: 'PluginServerError',
    });
  });

  it('uses the originating group member allowlist instead of the host assistant', async () => {
    vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
      (id) => () =>
        id === 'tool-message'
          ? ({ parentId: 'assistant-message' } as any)
          : ({ agentId: 'member-agent' } as any),
    );
    vi.spyOn(sessionSelectors, 'currentGroupAgents').mockReturnValue([
      { id: 'member-agent', skills: ['group-reviewer'] } as any,
    ]);
    vi.mocked(skillService.getSkill).mockResolvedValue({
      contentHash: 'hash-group',
      createdAt: new Date(0),
      description: 'Review group output.',
      identifier: 'group-reviewer',
      instructions: 'Review as the group member.',
      name: 'group-reviewer',
      sourceType: 'url',
      updatedAt: new Date(0),
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.load_skill('tool-message', { name: 'group-reviewer' });
    });

    expect(skillService.getSkill).toHaveBeenCalledWith('group-reviewer');
  });
});
