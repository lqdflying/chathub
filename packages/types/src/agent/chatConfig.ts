/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { z } from 'zod';

import { SearchMode } from '../search';

export type GPT5ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface GPT5ReasoningEffortResolution {
  effort: GPT5ReasoningEffort;
  effortValues: readonly GPT5ReasoningEffort[];
}

const GPT56_SOL_REASONING_EFFORTS: readonly GPT5ReasoningEffort[] = ['high', 'xhigh', 'max'];
const GPT55_REASONING_EFFORTS: readonly GPT5ReasoningEffort[] = ['high', 'xhigh'];
const LEGACY_GPT5_REASONING_EFFORTS: readonly GPT5ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
];

export const resolveGPT5ReasoningEffort = (
  model: string,
  requestedEffort: GPT5ReasoningEffort | undefined,
): GPT5ReasoningEffortResolution => {
  if (model === 'gpt-5.6-sol') {
    return {
      effort: GPT56_SOL_REASONING_EFFORTS.includes(requestedEffort as GPT5ReasoningEffort)
        ? (requestedEffort as GPT5ReasoningEffort)
        : 'high',
      effortValues: GPT56_SOL_REASONING_EFFORTS,
    };
  }

  if (model.startsWith('gpt-5.5')) {
    return {
      effort: GPT55_REASONING_EFFORTS.includes(requestedEffort as GPT5ReasoningEffort)
        ? (requestedEffort as GPT5ReasoningEffort)
        : 'high',
      effortValues: GPT55_REASONING_EFFORTS,
    };
  }

  return {
    effort: LEGACY_GPT5_REASONING_EFFORTS.includes(requestedEffort as GPT5ReasoningEffort)
      ? (requestedEffort as GPT5ReasoningEffort)
      : 'medium',
    effortValues: LEGACY_GPT5_REASONING_EFFORTS,
  };
};

export interface WorkingModel {
  model: string;
  provider: string;
}

export interface LobeAgentChatConfig {
  displayMode?: 'chat' | 'docs';

  enableAutoCreateTopic?: boolean;
  autoCreateTopicThreshold: number;

  enableMaxTokens?: boolean;

  /**
   * 是否开启流式输出
   */
  enableStreaming?: boolean;

  /**
   * 是否开启推理
   */
  enableReasoning?: boolean;
  /**
   * Moonshot kimi-k2.6 only: Preserved Thinking (`thinking.keep: "all"` in API).
   */
  moonshotPreservedReasoning?: boolean;
  /**
   * MiniMax M2.x (OpenAI-compatible): when false, disables `reasoning_split` so thinking
   * is not split into `reasoning_details`. Default on (matches historical behavior).
   */
  minimaxReasoningSplit?: boolean;
  /**
   * 自定义推理强度
   */
  enableReasoningEffort?: boolean;
  reasoningBudgetToken?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  gpt5ReasoningEffort?: GPT5ReasoningEffort;
  /**
   * 输出文本详细程度控制
   */
  textVerbosity?: 'low' | 'medium' | 'high';
  thinking?: 'disabled' | 'auto' | 'enabled';
  thinkingBudget?: number;
  /**
   * 禁用上下文缓存
   */
  disableContextCaching?: boolean;
  /**
   * 历史消息条数
   */
  historyCount?: number;
  /**
   * 开启历史记录条数
   */
  enableHistoryCount?: boolean;
  /**
   * 历史消息长度压缩阈值
   */
  enableCompressHistory?: boolean;

  /**
   * Preset: minimal | balanced | rich — maps to historyCount, compression, token auto-compact
   */
  assistanceLevel?: 'balanced' | 'minimal' | 'rich';

  /**
   * When estimated context usage exceeds contextCompactThreshold, run compaction (best-effort)
   */
  enableTokenThresholdAutoCompact?: boolean;

  /** Fraction of model context window (0–1) before token-based auto compact */
  contextCompactThreshold?: number;

  /** Opt-in: client-side daily compaction per session/topic */
  enableDailyMemorySummary?: boolean;

  /** Opt-in: at most once per UTC day per agent — LLM rollup of topic summaries into assistant memory */
  enablePeriodicAssistantMemoryRollup?: boolean;

  /** Append snapshot excerpts to topic metadata on compaction; optional prompt injection */
  enableUserMemoryArchive?: boolean;

  inputTemplate?: string;

  searchMode?: SearchMode;
  searchFCModel?: WorkingModel;
  urlContext?: boolean;
  useModelBuiltinSearch?: boolean;
}
/* eslint-enable */

export const AgentChatConfigSchema = z.object({
  assistanceLevel: z.enum(['balanced', 'minimal', 'rich']).optional(),
  autoCreateTopicThreshold: z.number().default(2),
  contextCompactThreshold: z.number().min(0).max(1).optional(),
  displayMode: z.enum(['chat', 'docs']).optional(),
  enableAutoCreateTopic: z.boolean().optional(),
  enableCompressHistory: z.boolean().optional(),
  enableDailyMemorySummary: z.boolean().optional(),
  enableHistoryCount: z.boolean().optional(),
  enableMaxTokens: z.boolean().optional(),
  enablePeriodicAssistantMemoryRollup: z.boolean().optional(),
  enableReasoning: z.boolean().optional(),
  enableReasoningEffort: z.boolean().optional(),
  enableStreaming: z.boolean().optional(),
  enableTokenThresholdAutoCompact: z.boolean().optional(),
  enableUserMemoryArchive: z.boolean().optional(),
  gpt5ReasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  historyCount: z.number().optional(),
  minimaxReasoningSplit: z.boolean().optional(),
  moonshotPreservedReasoning: z.boolean().optional(),
  reasoningBudgetToken: z.number().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  searchFCModel: z
    .object({
      model: z.string(),
      provider: z.string(),
    })
    .optional(),
  searchMode: z.enum(['off', 'on', 'auto']).optional(),
  textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
});
