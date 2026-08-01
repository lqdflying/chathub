import { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';

export const MemoryApiName = {
  deleteMemory: 'deleteMemory',
  saveMemory: 'saveMemory',
  updateMemory: 'updateMemory',
} as const;

const matchParameter = {
  description:
    'A short exact snippet copied from the current entry text (as shown in the injected memory), used to verify the target before writing',
  type: 'string',
};

const indexParameter = {
  description:
    "The entry number (#N) as it appears in THIS conversation's injected memory. Numbers are renumbered densely after deletions — never reuse numbers from older conversations.",
  type: 'number',
};

export const MemoryManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Save one durable fact, preference, or standing instruction into this assistant's fixed memory so it is remembered in every future chat. Use only for information that stays relevant beyond the current conversation.",
      name: MemoryApiName.saveMemory,
      parameters: {
        properties: {
          content: {
            description:
              "One concise, self-contained fact/preference/instruction to remember, in the user's language",
            type: 'string',
          },
        },
        required: ['content'],
        type: 'object',
      },
    },
    {
      description:
        'Rewrite one existing fixed-memory entry when a saved fact is corrected or superseded. The write is verified: if the entry no longer matches, the tool returns the current entry list — retry with those numbers.',
      name: MemoryApiName.updateMemory,
      parameters: {
        properties: {
          content: {
            description: 'The full replacement text for the entry',
            type: 'string',
          },
          index: indexParameter,
          match: matchParameter,
        },
        required: ['index', 'match', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Delete one fixed-memory entry when the user asks to forget it or it is clearly obsolete. Remaining entries are renumbered densely. Verified like updateMemory.',
      name: MemoryApiName.deleteMemory,
      parameters: {
        properties: {
          index: indexParameter,
          match: matchParameter,
        },
        required: ['index', 'match'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-memory',
  meta: {
    avatar: '🧠',
    title: 'Memory',
  },
  systemRole: systemPrompt(),
  type: 'builtin',
};
