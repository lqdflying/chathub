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
 * Build user message body from fixed memory (read-only context) + prior dream cards
 * + topic summaries for one UTC history day.
 */
export const buildAssistantMemoryDreamUserContent = (
  priorAssistantMemory: string | undefined,
  topics: AssistantMemoryDreamTopicInput[],
  options?: {
    fixedMemory?: string;
    historyDate?: string;
    maxCharsPerTopic?: number;
    maxTopics?: number;
  },
): string => {
  const maxTopics = options?.maxTopics ?? ASSISTANT_MEMORY_DREAM_MAX_TOPICS;
  const maxChars = options?.maxCharsPerTopic ?? ASSISTANT_MEMORY_DREAM_MAX_CHARS_PER_TOPIC;
  const historyDate = options?.historyDate ?? 'unknown';

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
    `## Prior dream memory cards (read-only — do not rewrite or duplicate)\n\n${prior || '(empty)'}`,
    `## Topic summaries from UTC day ${historyDate} (newest first; ${blocks.length} topics)\n\n${blocks.join('\n\n---\n\n')}`,
  );

  return sections.join('\n\n');
};

export const chainAssistantMemoryDream = (params: {
  fixedMemory?: string;
  historyDate?: string;
  priorAssistantMemory?: string;
  topics: AssistantMemoryDreamTopicInput[];
}): Partial<ChatStreamPayload> => {
  const historyDate = params.historyDate ?? 'unknown';
  const userContent = buildAssistantMemoryDreamUserContent(
    params.priorAssistantMemory,
    params.topics,
    { fixedMemory: params.fixedMemory, historyDate },
  );

  return {
    messages: [
      {
        content: `You maintain the "dynamic memory" of an AI assistant: durable notes injected into every future chat. This is a scheduled DREAM pass for UTC day ${historyDate}. Your job is to learn HOW the user works with this assistant so future replies feel more customized — not to recap what was discussed.

Admission test — include a signal ONLY if it would change how the assistant behaves in a future, unrelated conversation. Qualifying categories:
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

Output rules:
- Output ONLY the body text for ONE new dream-memory card for UTC day ${historyDate}. Do NOT output card headers like "#N [date]:" — the system adds those.
- Do NOT rewrite, merge, or replace prior dream cards; they are read-only context above.
- Do NOT duplicate anything already covered in fixed memory or prior dream cards.
- Organize by category (Preferences / Interaction style / Workflow), never by topic. A "Topic N: ..." structure is forbidden.
- A short memory is better than a padded one. Most days contain nothing new — extracting nothing is the normal case. Never add filler.
- Write in the dominant language of the prior dream cards and topic summaries.

If the listed topics contain no new durable signal beyond what is already in prior dream cards or fixed memory, output exactly ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL}.
Otherwise output only the new card body text, without preamble or explanation.`,
        role: 'system',
      },
      {
        content: `${userContent}\n\nWrite the new dream-memory card body for UTC day ${historyDate} now, or output ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL} if nothing durable changed.`,
        role: 'user',
      },
    ],
  };
};

export {
  ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS as ASSISTANT_MEMORY_DREAM_MAX_OUTPUT_TOKENS,
} from './assistantMemoryRollup';
