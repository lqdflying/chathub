import { ChatStreamPayload } from '@lobechat/types';

export interface AssistantMemoryRollupTopicInput {
  historySummary: string | null;
  sessionId: string | null;
  title: string | null;
}

const DEFAULT_MAX_TOPICS = 150;
const DEFAULT_MAX_CHARS_PER_TOPIC = 4000;

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
  const maxTopics = options?.maxTopics ?? DEFAULT_MAX_TOPICS;
  const maxChars = options?.maxCharsPerTopic ?? DEFAULT_MAX_CHARS_PER_TOPIC;

  const prior = (priorAssistantMemory ?? '').trim();
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
        content: `You merge "prior assistant memory" with summaries from multiple chat topics (each topic belongs to a session linked to the same assistant). Produce a single updated assistant memory document that:
- Preserves important facts, preferences, and continuity across sessions.
- De-duplicates overlapping information.
- Uses the same language as the source material when possible.
- Stays concise; aim under roughly 2000 tokens of output.
- Uses markdown sections or bullets if helpful.

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
