import { BuiltinToolManifest } from '@lobechat/types';

export const SkillLoaderApiName = 'load_skill';

export const SkillLoaderManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Load the full instructions for an enabled skill when the user request matches it. Only use an available skill identifier.',
      name: SkillLoaderApiName,
      parameters: {
        additionalProperties: false,
        properties: {
          name: { description: 'The available skill identifier to activate', type: 'string' },
        },
        required: ['name'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-skill-loader',
  meta: {
    avatar: '✨',
    title: 'Skill loader',
  },
  systemRole:
    'Installed skills are listed by name and description. Call load_skill only when a listed skill is relevant to the user request.',
  type: 'builtin',
};
