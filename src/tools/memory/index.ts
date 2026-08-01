import { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';

export const MemoryApiName = {
  saveMemory: 'saveMemory',
} as const;

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
  ],
  identifier: 'lobe-memory',
  meta: {
    avatar: '🧠',
    title: 'Memory',
  },
  systemRole: systemPrompt(),
  type: 'builtin',
};
