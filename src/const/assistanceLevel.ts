import { type LobeAgentChatConfig } from '@lobechat/types';

export type AssistanceLevel = NonNullable<LobeAgentChatConfig['assistanceLevel']>;

export const assistanceLevelToChatConfigPatch = (
  level: AssistanceLevel,
): Partial<LobeAgentChatConfig> => {
  switch (level) {
    case 'minimal':
      return {
        assistanceLevel: 'minimal',
        enableCompressHistory: true,
        enableHistoryCount: true,
        enableTokenThresholdAutoCompact: false,
        historyCount: 8,
      };
    case 'rich':
      return {
        assistanceLevel: 'rich',
        enableCompressHistory: true,
        enableHistoryCount: true,
        enableTokenThresholdAutoCompact: true,
        historyCount: 32,
      };
    case 'balanced':
    default:
      return {
        assistanceLevel: 'balanced',
        enableCompressHistory: true,
        enableHistoryCount: true,
        enableTokenThresholdAutoCompact: false,
        historyCount: 20,
      };
  }
};
