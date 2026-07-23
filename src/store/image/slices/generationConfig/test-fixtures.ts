import { ModelParamsSchema } from 'model-bank';

/**
 * Representative image-model schema used by generation-config tests.
 * Kept test-local so removed provider model banks are not restored as production exports.
 */
export const testFluxSchnellParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: ['16:9', '4:3', '1:1', '3:4', '9:16'],
  },
  cfg: { default: 1, max: 1, min: 1, step: 0 },
  height: { default: 1024, max: 1536, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'simple' },
  seed: { default: null },
  steps: { default: 4, max: 4, min: 1, step: 1 },
  width: { default: 1024, max: 1536, min: 512, step: 8 },
};
