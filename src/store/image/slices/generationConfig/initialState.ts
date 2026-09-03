/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import {
  ModelParamsSchema,
  ModelProvider,
  RuntimeImageGenParams,
  extractDefaultValues,
  gptImage2CompatibleParamsSchema,
} from 'model-bank';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.OpenAI;
export const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-2';

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - 虚拟比例; null - 原生比例

  /**
   * 标记配置是否已初始化（包括从记忆中恢复）
   */
  isInit: boolean;
  /**
   * Tracks whether the current owner supplied any persisted image preference.
   */
  hasRememberedImageConfig: boolean;
  /**
   * Identifies the signed-in account or guest scope that supplied the current preferences.
   */
  preferenceOwner?: string;
  /**
   * 标记当前是否存在可用的图像生成模型
   */
  isImageModelAvailable: boolean;
}

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: RuntimeImageGenParams =
  extractDefaultValues(gptImage2CompatibleParamsSchema);

export const initialGenerationConfigState: GenerationConfigState = {
  model: DEFAULT_AI_IMAGE_MODEL,
  provider: DEFAULT_AI_IMAGE_PROVIDER,
  imageNum: DEFAULT_IMAGE_CONFIG.defaultImageNum,
  parameters: DEFAULT_IMAGE_GENERATION_PARAMETERS,
  parametersSchema: gptImage2CompatibleParamsSchema,
  isAspectRatioLocked: false,
  activeAspectRatio: null,
  hasRememberedImageConfig: false,
  isInit: false,
  isImageModelAvailable: false,
  preferenceOwner: undefined,
};
