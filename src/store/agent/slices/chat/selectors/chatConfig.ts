import { contextCachingModels, thinkingWithToolClaudeModels } from '@/const/models';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@/const/settings';
import { resolveMemoryDreamSchedule } from '@/helpers/assistantMemory';
import { AgentStoreState } from '@/store/agent/initialState';
import { LobeAgentChatConfig } from '@/types/agent';

import { currentAgentConfig } from './agent';

export const currentAgentChatConfig = (s: AgentStoreState): LobeAgentChatConfig =>
  currentAgentConfig(s).chatConfig || {};

const agentSearchMode = (s: AgentStoreState) => currentAgentChatConfig(s).searchMode || 'off';
const isAgentEnableSearch = (s: AgentStoreState) => agentSearchMode(s) !== 'off';

const useModelBuiltinSearch = (s: AgentStoreState) =>
  currentAgentChatConfig(s).useModelBuiltinSearch;

const searchFCModel = (s: AgentStoreState) =>
  currentAgentChatConfig(s).searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL;

const enableHistoryCount = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);
  const chatConfig = currentAgentChatConfig(s);

  // 如果开启了上下文缓存，且当前模型类型匹配，则不开启历史记录
  const enableContextCaching = !chatConfig.disableContextCaching;

  if (enableContextCaching && contextCachingModels.has(config.model)) return false;

  // 当开启搜索时，针对 claude 3.7 sonnet 模型不开启历史记录
  const enableSearch = isAgentEnableSearch(s);

  if (enableSearch && thinkingWithToolClaudeModels.has(config.model)) return false;

  return chatConfig.enableHistoryCount;
};

const historyCount = (s: AgentStoreState): number => {
  const chatConfig = currentAgentChatConfig(s);

  return chatConfig.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number); // historyCount 为 0 即不携带历史消息
};

const displayMode = (s: AgentStoreState) => {
  const chatConfig = currentAgentChatConfig(s);

  return chatConfig.displayMode || 'chat';
};

const enableHistoryDivider =
  (historyLength: number, currentIndex: number) => (s: AgentStoreState) => {
    const config = currentAgentChatConfig(s);

    return (
      enableHistoryCount(s) &&
      historyLength > (config.historyCount ?? 0) &&
      config.historyCount === historyLength - currentIndex
    );
  };

const assistanceLevel = (s: AgentStoreState) =>
  currentAgentChatConfig(s).assistanceLevel ?? DEFAULT_AGENT_CHAT_CONFIG.assistanceLevel!;

const enableTokenThresholdAutoCompact = (s: AgentStoreState) =>
  currentAgentChatConfig(s).enableTokenThresholdAutoCompact ??
  DEFAULT_AGENT_CHAT_CONFIG.enableTokenThresholdAutoCompact!;

const contextCompactThreshold = (s: AgentStoreState) =>
  currentAgentChatConfig(s).contextCompactThreshold ??
  DEFAULT_AGENT_CHAT_CONFIG.contextCompactThreshold!;

const enableAssistantMemory = (s: AgentStoreState) =>
  currentAgentChatConfig(s).enableAssistantMemory ??
  DEFAULT_AGENT_CHAT_CONFIG.enableAssistantMemory!;

const memoryDreamSchedule = (s: AgentStoreState) =>
  resolveMemoryDreamSchedule(currentAgentChatConfig(s));

const memoryDreamScheduleFrequency = (s: AgentStoreState) => memoryDreamSchedule(s).frequency;

const memoryDreamScheduleTime = (s: AgentStoreState) => memoryDreamSchedule(s).time;

const memoryDreamScheduleWeekday = (s: AgentStoreState) => memoryDreamSchedule(s).weekday;

const enableUserMemoryArchive = (s: AgentStoreState) =>
  currentAgentChatConfig(s).enableUserMemoryArchive ??
  DEFAULT_AGENT_CHAT_CONFIG.enableUserMemoryArchive!;

export const agentChatConfigSelectors = {
  agentSearchMode,
  assistanceLevel,
  contextCompactThreshold,
  currentChatConfig: currentAgentChatConfig,
  displayMode,
  enableAssistantMemory,
  enableHistoryCount,
  enableHistoryDivider,
  enableTokenThresholdAutoCompact,
  enableUserMemoryArchive,
  historyCount,
  isAgentEnableSearch,
  memoryDreamScheduleFrequency,
  memoryDreamScheduleTime,
  memoryDreamScheduleWeekday,
  searchFCModel,
  useModelBuiltinSearch,
};
