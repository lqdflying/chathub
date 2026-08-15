import { BuiltinToolManifest } from '@lobechat/types';

// import {SiOpenai} from "@icons-pack/react-simple-icons";

export const DalleManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'Create images from a text-only prompt.',
      name: 'text2image',
      parameters: {
        properties: {
          prompts: {
            description:
              "A list of image captions to generate. Each caption is a detailed, self-contained description of one image. If the user does not specify a number, create up to 4 captions that are as diverse as possible; never more than 4. If the user asks to modify a previous image, refactor the caption to integrate the changes rather than just making it longer. Image size, quality and other rendering options come from the user's configured image model — do not include them here.",
            items: {
              type: 'string',
            },
            maxItems: 4,
            minItems: 1,
            type: 'array',
          },
        },
        required: ['prompts'],
        type: 'object',
      },
    },
  ],
  // due to system prompt is for training Dalle3 as a built-in tool by OpenAI,
  // there are occasional instances where the function call contains the name "dalle," leading to subsequent failures.
  // so we need a different unique identifier to avoid failure.refs:
  // https://github.com/lobehub/lobe-chat/issues/783
  // https://github.com/lobehub/lobe-chat/issues/870
  identifier: 'lobe-image-designer',
  meta: {
    avatar: `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgeD0iMyIgeT0iMyIgcng9IjIiIHJ5PSIyIi8+PGNpcmNsZSBjeD0iOSIgY3k9IjkiIHI9IjIiLz48cGF0aCBkPSJtMjEgMTUtMy4wODYtMy4wODZhMiAyIDAgMCAwLTIuODI4IDBMNiAyMSIvPjwvc3ZnPg==`,
    title: 'Image',
  },
  systemRole: `When the user asks for an image, use lobe-image-designer to generate it, then briefly summarize the prompts you used in plain text. This tool works with whichever image model the user has configured, so keep the captions model-agnostic.

Guidelines for the captions sent to lobe-image-designer:

1. If the user does not specify a number, create up to 4 images with captions that are as diverse as possible; never generate more than 4, even if the user requests more.
2. Each caption must be a detailed, self-contained paragraph — more than 3 sentences — describing the subject, composition, style, lighting and mood in concrete, objective terms.
3. State the image type (photo, illustration, oil painting, watercolor, cartoon, 3D render, vector, etc.) at the start of each caption. Unless the request suggests otherwise, make at least 1–2 of the images photos.
4. For best results write captions in English; translate non-English descriptions.
5. When depicting groups of people, aim for diverse, inclusive scenes, but keep the number of people the user asked for and don't alter memes, fictional characters, or a clearly-specified subject.
6. Do not generate images of real, identifiable public figures; substitute a generic description instead. Avoid content that is offensive or unsafe.
7. Do not restate the captions before or after generating — they belong only in the \`prompts\` field. You don't need to ask for permission; just generate.`,
  type: 'builtin',
};
