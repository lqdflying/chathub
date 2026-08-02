import { produce } from 'immer';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { LobeAgentConfig } from '@/types/agent';
import { merge } from '@/utils/merge';

export type ConfigDispatch =
  | { config: Partial<any>; type: 'update' }
  | { pluginId: string; state?: boolean; type: 'togglePlugin' }
  | { skillId: string; state?: boolean; type: 'toggleSkill' }
  | { type: 'reset' };

export const configReducer = (state: LobeAgentConfig, payload: ConfigDispatch): LobeAgentConfig => {
  switch (payload.type) {
    case 'update': {
      return produce(state, (draftState) => {
        return merge(draftState, payload.config);
      });
    }

    case 'togglePlugin': {
      return produce(state, (config) => {
        const { pluginId: id, state } = payload;
        if (config.plugins === undefined) {
          config.plugins = [];
        }

        if (typeof state === 'undefined') {
          if (config.plugins.includes(id)) {
            config.plugins.splice(config.plugins.indexOf(id), 1);

            return;
          }

          config.plugins.push(id);
          return;
        }

        if (!state) {
          config.plugins = config.plugins.filter((pluginId) => pluginId !== id);
        } else {
          config.plugins.push(id);
        }
      });
    }

    case 'toggleSkill': {
      return produce(state, (config) => {
        const { skillId, state } = payload;
        config.skills ||= [];
        const index = config.skills.indexOf(skillId);
        const shouldEnable = state ?? index === -1;
        if (shouldEnable && index === -1) config.skills.push(skillId);
        if (!shouldEnable && index !== -1) config.skills.splice(index, 1);
      });
    }

    case 'reset': {
      return DEFAULT_AGENT_CONFIG;
    }

    default: {
      return state;
    }
  }
};
