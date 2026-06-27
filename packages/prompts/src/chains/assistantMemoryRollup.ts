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

/** Truncate one topic summary for prompt size control. */
export const capTopicSummaryText = (text: string | null, maxChars: number): string => {
  const t = (text ?? '').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n…`;
};

/**
 * Build user message body from prior memory + topic rows (only non-empty summaries included).
 */
export const buildAssistantMemoryRollupUserContent = (
  priorAssistantMemory: string | undefined,
  topics: AssistantMemoryRollupTopicInput[],
  options?: { maxCharsPerTopic?: number; maxTopics?: number },
): string => {
  const maxTopics = options?.maxTopics ?? ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS;
  const maxChars = options?.maxCharsPerTopic ?? ASSISTANT_MEMORY_ROLLUP_MAX_CHARS_PER_TOPIC;

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

  const headerPrior = `## Prior assistant memory\n\n${prior || '(empty)'}`;
  const headerTopics = `## Topic compaction summaries (newest first; ${blocks.length} topics)\n\n${blocks.join('\n\n---\n\n')}`;

  return `${headerPrior}\n\n${headerTopics}`;
};

export const chainAssistantMemoryRollup = (params: {
  priorAssistantMemory?: string;
  topics: AssistantMemoryRollupTopicInput[];
}): Partial<ChatStreamPayload> => {
  const userContent = buildAssistantMemoryRollupUserContent(
    params.priorAssistantMemory,
    params.topics,
  );

  return {
    messages: [
      {
        content: `You maintain "assistant memory": compact startup context injected into every new chat with this assistant.

Produce a single updated assistant memory document that:
- Keeps only durable information useful across future chats: stable user preferences, assistant operating rules, long-running projects, and unresolved commitments.
- Removes completed tasks, raw timelines, duplicate topic summaries, session identifiers, transient details, and anything useful only inside one past chat.
- Rewrites and deduplicates aggressively instead of merging topic text.
- Uses the same language as the source material when possible.
- Targets ${ASSISTANT_MEMORY_TARGET_TOKENS} tokens or less.
- Uses short markdown sections or bullets if helpful.

Output only the new assistant memory text, without preamble or explanation.`,
        role: 'system',
      },
      {
        content: `${userContent}\n\nPlease output the merged assistant memory now.`,
        role: 'user',
      },
    ],
  };
};
