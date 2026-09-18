import { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';

export const MemoryApiName = {
  deleteMemory: 'deleteMemory',
  readMemory: 'readMemory',
  saveMemory: 'saveMemory',
  searchMemory: 'searchMemory',
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
    {
      description:
        "Search this assistant's memory (fixed entries and dynamic dream cards) by keywords and get the most relevant entries with their numbers. Use when the injected memory is marked truncated, or before updating an entry you cannot see. Snippets are capped; call readMemory with a hit's source and index to read the complete entry.",
      name: MemoryApiName.searchMemory,
      parameters: {
        properties: {
          limit: {
            description: 'Maximum entries to return (default 5, max 10)',
            type: 'number',
          },
          query: {
            description:
              "Keywords to look for, in the user's language. CJK text is matched by character bigrams, so short phrases work.",
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description:
        "Read this assistant's memory. With no arguments, returns the full text of both tiers (fixed entries and dynamic dream cards); very large memories may be truncated by the request pipeline. To read one complete entry — for example one omitted from the injected memory — pass source ('fixed' or 'dynamic') and index from a searchMemory hit. Long entries are returned in pages: when the result has truncated: true, call again with offset set to the returned nextOffset to continue.",
      name: MemoryApiName.readMemory,
      parameters: {
        properties: {
          index: {
            description: 'Entry number within its tier (the #N from a searchMemory hit)',
            type: 'number',
          },
          offset: {
            description:
              'Continuation offset for a paged entry read (the nextOffset from a truncated result)',
            type: 'number',
          },
          source: {
            description:
              "Memory tier of the entry: 'fixed' for numbered fixed entries, 'dynamic' for dream cards",
            enum: ['fixed', 'dynamic'],
            type: 'string',
          },
        },
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
