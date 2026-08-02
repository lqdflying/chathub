import { StateCreator } from 'zustand/vanilla';

import { skillService } from '@/services/skill';
import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

export interface SkillAction {
  load_skill: (
    id: string,
    params: { name: string },
    aiSummary?: boolean,
    diagnosticId?: string,
  ) => Promise<boolean | undefined>;
}

export const skillSlice: StateCreator<ChatStore, [['zustand/devtools', never]], [], SkillAction> = (
  set,
  get,
) => ({
  load_skill: async (id, params) => {
    const toolMessage = chatSelectors.getMessageById(id)(get());
    const parentMessage = toolMessage?.parentId
      ? chatSelectors.getMessageById(toolMessage.parentId)(get())
      : undefined;
    const groupAgentId = parentMessage?.agentId;
    const groupAgent =
      groupAgentId && groupAgentId !== 'supervisor'
        ? sessionSelectors
            .currentGroupAgents(useSessionStore.getState())
            .find(({ id: agentId }) => agentId === groupAgentId)
        : undefined;
    const enabled =
      groupAgentId && groupAgentId !== 'supervisor'
        ? groupAgent?.skills || []
        : agentSelectors.currentAgentSkills(getAgentStoreState());
    const identifier = params?.name?.trim();
    if (!identifier || !enabled.includes(identifier)) {
      await get().internal_updatePluginError(id, {
        message: 'The requested skill is not enabled for this assistant.',
        type: 'PluginServerError',
      });
      return false;
    }

    const skill = await skillService.getSkill(identifier);
    if (!skill) {
      await get().internal_updatePluginError(id, {
        message: 'The requested skill is not installed.',
        type: 'PluginServerError',
      });
      return false;
    }

    await get().internal_updateMessageContent(
      id,
      JSON.stringify({
        contentHash: skill.contentHash,
        identifier: skill.identifier,
        name: skill.name,
        status: 'loaded',
      }),
      { metadata: { skills: { activated: [skill.identifier] } } },
    );
    return true;
  },
});
