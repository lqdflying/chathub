import { ChatStreamPayload } from '@lobechat/types';

import {
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
  ASSISTANT_MEMORY_ROLLUP_MAX_FIXED_CHARS,
  ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS,
  capTopicSummaryText,
} from './assistantMemoryRollup';

export interface AssistantMemoryDreamTopicInput {
  historySummary: string | null;
  sessionId: string | null;
  title: string | null;
}

/** Dream prompt bounds mirror the rollup so the two paths stay interchangeable. */
export const ASSISTANT_MEMORY_DREAM_MAX_TOPICS = 30;
export const ASSISTANT_MEMORY_DREAM_MAX_CHARS_PER_TOPIC = 1200;


/**
 * Build user message body from fixed memory (read-only context) + prior dynamic memory
 * + yesterday's active topic summaries.
 */
export const buildAssistantMemoryDreamUserContent = (
  priorAssistantMemory: string | undefined,
  topics: AssistantMemoryDreamTopicInput[],
  options?: {
    fixedMemory?: string;
    maxCharsPerTopic?: number;
    maxTopics?: number;
  },
): string => {
  const maxTopics = options?.maxTopics ?? ASSISTANT_MEMORY_DREAM_MAX_TOPICS;
  const maxChars = options?.maxCharsPerTopic ?? ASSISTANT_MEMORY_DREAM_MAX_CHARS_PER_TOPIC;

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

  sections.push(
    `## Prior dynamic memory\n\n${prior || '(empty)'}`,
    `## Topic summaries from the user's last active day (newest first; ${blocks.length} topics)\n\n${blocks.join('\n\n---\n\n')}`,
  );

  return sections.join('\n\n');
};

export const chainAssistantMemoryDream = (params: {
  fixedMemory?: string;
  priorAssistantMemory?: string;
  topics: AssistantMemoryDreamTopicInput[];
}): Partial<ChatStreamPayload> => {
  const userContent = buildAssistantMemoryDreamUserContent(
    params.priorAssistantMemory,
    params.topics,
    { fixedMemory: params.fixedMemory },
  );

  return {
    messages: [
      {
        content: `You maintain the "dynamic memory" of an AI assistant: a small durable document injected into every future chat with this assistant. This is a scheduled DREAM pass: your job is to learn HOW the user works with this assistant so future replies feel more customized — not to recap what was discussed.

Admission test — include an item ONLY if it would change how the assistant behaves in a future, unrelated conversation. Qualifying categories:
- Communication style: tone, format, language, level of detail the user prefers.
- Interaction patterns: how the user phrases requests, corrects the assistant, or steers tasks.
- Tool and workflow habits: which tools/features the user relies on and how they expect them used.
- Standing preferences and constraints that keep recurring across topics.

Always exclude:
- Per-topic recaps or digests of what was discussed.
- Subjects of one-off questions and answers.
- Completed or resolved tasks.
- General knowledge the assistant already has.
- Session identifiers, raw timelines, and anything useful only inside the chat it came from.

Editing rules:
- Start from the prior dynamic memory and edit it minimally: keep existing entries verbatim unless a topic summary contradicts or supersedes them; merge genuinely new durable signals; delete only clearly obsolete items.
- Organize the output by category (for example: Preferences / Interaction style / Workflow), never by topic or conversation. A "Topic N: ..." structure is forbidden.
- If fixed memory is provided, never copy, restate, or contradict it; omit anything it already covers.
- A short memory is better than a padded one. Most days contain nothing new — extracting nothing is the normal case. Never add filler.
- Write in the dominant language of the prior memory and topic summaries.

If the listed topics contain no new durable signal and nothing in the prior dynamic memory needs updating, output exactly ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL}.
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

export {
  ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS as ASSISTANT_MEMORY_DREAM_MAX_OUTPUT_TOKENS,
} from './assistantMemoryRollup';