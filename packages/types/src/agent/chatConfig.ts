/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { z } from 'zod';

import { SearchMode } from '../search';

export type GPT5ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface GPT5ReasoningEffortResolution {
  effort: GPT5ReasoningEffort;
  effortValues: readonly GPT5ReasoningEffort[];
}

const GPT56_SOL_REASONING_EFFORTS: readonly GPT5ReasoningEffort[] = ['high', 'xhigh', 'max'];
const GPT56_FAMILY_REASONING_EFFORTS: readonly GPT5ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
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

  if (model.startsWith('gpt-5.6')) {
    return {
      effort: GPT56_FAMILY_REASONING_EFFORTS.includes(requestedEffort as GPT5ReasoningEffort)
        ? (requestedEffort as GPT5ReasoningEffort)
        : 'medium',
      effortValues: GPT56_FAMILY_REASONING_EFFORTS,
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
   * MiniMax OpenAI-compatible: when false, sets `reasoning_split: false` so thinking
   * stays in `content` (`<think>` tags) instead of `reasoning_content` /
   * `reasoning_details`. Does **not** turn thinking off. Default on.
   */
  minimaxReasoningSplit?: boolean;
  /**
   * Zhipu GLM reasoning effort. GLM-5.2: 'max' | 'high' | 'skip' ('skip' → API `none`).
   * GLM-5.3 / GLM-5.3-Flash: 'low' | 'high' | 'max' (thinking cannot be disabled;
   * leftover 'skip' maps to API `low`). Only sent when thinking is on.
   */
  zhipuReasoningEffort?: 'high' | 'low' | 'max' | 'skip';
  /**
   * Zhipu GLM: when true, enables Preserved Thinking (`thinking.clear_thinking: false`),
   * replaying historical `reasoning_content` unmodified for multi-turn reasoning
   * continuity. Default false (Zhipu server default strips prior thinking from
   * context to reduce cost).
   */
  zhipuPreservedThinking?: boolean;
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

  /** Fraction of model context window (0.5–0.99) before token-based auto compact */
  contextCompactThreshold?: number;

  /**
   * Master switch for assistant memory (fixed + dynamic): injection, rollup, and the
   * save-memory tool. Default true; turn off for stateless assistants.
   */
  enableAssistantMemory?: boolean;

  /**
   * @deprecated Kept for read-time migration into `memoryDreamScheduleFrequency`.
   * Former "Daily topic note" toggle — do not read at runtime.
   */
  enableDailyMemorySummary?: boolean;

  /**
   * @deprecated Kept for read-time migration into `memoryDreamScheduleFrequency`.
   * Former periodic rollup toggle — do not read at runtime.
   */
  enablePeriodicAssistantMemoryRollup?: boolean;

  /**
   * Keep the newest N single-day dream-memory cards; older single-day cards merge
   * into one range-tagged card. Default 14; range 1–90.
   */
  memoryDreamMaxEntries?: number;

  /**
   * Server-side memory dream schedule. Times are UTC.
   * `'off'` (default) / `'daily'` / `'weekly'`.
   */
  memoryDreamScheduleFrequency?: 'daily' | 'off' | 'weekly';

  /** Earliest UTC time (`HH:mm`) the dream may run. Default `'02:00'`. */
  memoryDreamScheduleTime?: string;

  /** UTC weekday (0 = Sunday … 6 = Saturday) when frequency is `'weekly'`. Default 0. */
  memoryDreamScheduleWeekday?: number;

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
  contextCompactThreshold: z.number().min(0.5).max(0.99).optional(),
  displayMode: z.enum(['chat', 'docs']).optional(),
  enableAssistantMemory: z.boolean().optional(),
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
  memoryDreamMaxEntries: z.number().int().min(1).max(90).optional(),
  memoryDreamScheduleFrequency: z.enum(['daily', 'off', 'weekly']).optional(),
  memoryDreamScheduleTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  memoryDreamScheduleWeekday: z.number().int().min(0).max(6).optional(),
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
  zhipuPreservedThinking: z.boolean().optional(),
  zhipuReasoningEffort: z.enum(['max', 'high', 'low', 'skip']).optional(),
});
