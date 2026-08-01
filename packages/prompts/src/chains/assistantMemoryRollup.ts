import { ChatStreamPayload } from '@lobechat/types';

export interface AssistantMemoryRollupTopicInput {
  historySummary: string | null;
  sessionId: string | null;
  title: string | null;
}

export const ASSISTANT_MEMORY_TARGET_TOKENS = 800;
export const ASSISTANT_MEMORY_MAX_CHARS = 3200;
export const ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS = 40;
export const ASSISTANT_MEMORY_ROLLUP_MAX_CHARS_PER_TOPIC = 1200;
export const ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS = 3200;
export const ASSISTANT_MEMORY_ROLLUP_MAX_FIXED_CHARS = 3200;
/** Request-level output cap: 2x the target so post-capping trims, not the provider mid-sentence. */
export const ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS = 1600;
/** Exact model output meaning "nothing durable changed; keep the memory as is". */
export const ASSISTANT_MEMORY_NO_CHANGES_SENTINEL = 'NO_CHANGES';

/** Truncate one topic summary for prompt size control. */
export const capTopicSummaryText = (text: string | null, maxChars: number): string => {
  const t = (text ?? '').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n…`;
};

/**
 * Build user message body from fixed memory (read-only context) + prior dynamic memory
 * + topic rows (only non-empty summaries included).
 */
export const buildAssistantMemoryRollupUserContent = (
  priorAssistantMemory: string | undefined,
  topics: AssistantMemoryRollupTopicInput[],
  options?: {
    fixedMemory?: string;
    incremental?: boolean;
    maxCharsPerTopic?: number;
    maxTopics?: number;
  },
): string => {
  const maxTopics = options?.maxTopics ?? ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS;
  const maxChars = options?.maxCharsPerTopic ?? ASSISTANT_MEMORY_ROLLUP_MAX_CHARS_PER_TOPIC;

  const fixed = capTopicSummaryText(
    options?.fixedMemory ?? '',
    ASSISTANT_MEMORY_ROLLUP_MAX_FIXED_CHARS,
  );
  const prior = capTopicSummaryText(
    priorAssistantMemory ?? '',
    ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS,
  );
  const withContent = topics
    .filter((t) => (t.historySummary ?? '').trim().length > 0)
    .slice(0, maxTopics);

  const blocks = withContent.map((t, i) => {
    const title = (t.title ?? '').trim() || '(untitled)';
    const sid = (t.sessionId ?? '').trim() || '(unknown)';
    const body = capTopicSummaryText(t.historySummary, maxChars);
    return `### ${i + 1}. ${title}\nSession: ${sid}\n\n${body}`;
  });

  const sections: string[] = [];

  if (fixed) {
    sections.push(
      `## Fixed memory (read-only context — never copy, restate, or contradict it)\n\n${fixed}`,
    );
  }

  sections.push(`## Prior dynamic memory\n\n${prior || '(empty)'}`);

  const topicsHeader = options?.incremental
    ? `## Changed topic summaries since the last rollup (newest first; ${blocks.length} topics)\n\nOnly topics that changed since the last rollup are listed. Keep prior-memory content about unlisted topics.`
    : `## Topic compaction summaries (newest first; ${blocks.length} topics)`;
  sections.push(`${topicsHeader}\n\n${blocks.join('\n\n---\n\n')}`);

  return sections.join('\n\n');
};

export const chainAssistantMemoryRollup = (params: {
  fixedMemory?: string;
  incremental?: boolean;
  priorAssistantMemory?: string;
  topics: AssistantMemoryRollupTopicInput[];
}): Partial<ChatStreamPayload> => {
  const userContent = buildAssistantMemoryRollupUserContent(
    params.priorAssistantMemory,
    params.topics,
    { fixedMemory: params.fixedMemory, incremental: params.incremental },
  );

  return {
    messages: [
      {
        content: `You maintain the "dynamic memory" of an AI assistant: a small durable document injected into every future chat with this assistant. Your job is to curate durable knowledge, NOT to consolidate or recap conversations.

Admission test — include an item ONLY if knowing it would change how the assistant behaves in a future, unrelated conversation. Qualifying categories:
- Stable user preferences and profile facts (tone, format, language, tools, constraints).
- Standing instructions and corrections ("always do X", "never do Y").
- Long-running projects: their goal and current state.
- Commitments made to the user that are still open.

Always exclude:
- Per-topic recaps or digests of what was discussed.
- Subjects of one-off questions and answers.
- Completed or resolved tasks.
- General knowledge the assistant already has.
- Session identifiers, raw timelines, and anything useful only inside the chat it came from.

Editing rules:
- Start from the prior dynamic memory and edit it minimally: keep existing entries verbatim unless a topic summary contradicts or supersedes them; merge genuinely new durable facts; delete only clearly obsolete items.
- Organize the output by category (for example: Preferences / Instructions / Projects / Commitments), never by topic or conversation. A "Topic N: ..." structure is forbidden.
- If fixed memory is provided, never copy, restate, or contradict it; omit anything it already covers.
- A short memory is better than a padded one. Most topics contain nothing durable — extracting nothing from a topic is the normal case. Never add filler; ${ASSISTANT_MEMORY_TARGET_TOKENS} tokens is a ceiling, not a goal.
- Write in the dominant language of the prior memory and topic summaries.

If the listed topics contain no new durable information and nothing in the prior dynamic memory needs updating, output exactly ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL}.

Otherwise output only the updated dynamic memory text, without preamble or explanation.`,
        role: 'system',
      },
      {
        content: `${userContent}\n\nUpdate the dynamic memory now, or output ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL} if nothing durable changed.`,
        role: 'user',
      },
    ],
  };
};
