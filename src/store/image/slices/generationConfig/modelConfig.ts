import { ModelParamsSchema, extractDefaultValues } from 'model-bank';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';

import { calculateInitialAspectRatio } from '../../utils/aspectRatio';

export function getModelAndDefaults(model: string, provider: string) {
  const enabledImageModelList = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());

  const providerItem = enabledImageModelList.find((providerItem) => providerItem.id === provider);
  if (!providerItem) {
    throw new Error(
      `Provider "${provider}" not found in enabled image provider list. Available providers: ${enabledImageModelList.map((providerItem) => providerItem.id).join(', ')}`,
    );
  }

  const activeModel = providerItem.children.find((modelItem) => modelItem.id === model);
  if (!activeModel) {
    throw new Error(
      `Model "${model}" not found in provider "${provider}". Available models: ${providerItem.children.map((modelItem) => modelItem.id).join(', ')}`,
    );
  }

  const parametersSchema = Reflect.get(activeModel, 'parameters') as ModelParamsSchema;
  const defaultValues = extractDefaultValues(parametersSchema);

  return { activeModel, defaultValues, parametersSchema };
}

export function prepareImageModelConfigState(model: string, provider: string) {
  const { defaultValues, parametersSchema } = getModelAndDefaults(model, provider);
  const initialActiveRatio = calculateInitialAspectRatio(parametersSchema, defaultValues);

  return {
    defaultValues,
    initialActiveRatio,
    parametersSchema,
  };
}

export function isImageModelConfigUsable(model: string, provider: string): boolean {
  try {
    prepareImageModelConfigState(model, provider);
    return true;
  } catch {
    return false;
  }
}
