import { MAX_IMAGE_GENERATION_COUNT, MIN_IMAGE_GENERATION_COUNT } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import {
  AIImageModelCard,
  ModelParamsSchema,
  RuntimeImageGenParams,
  RuntimeImageGenParamsKeys,
  RuntimeImageGenParamsValue,
  extractDefaultValues,
} from 'model-bank';
import { StateCreator } from 'zustand/vanilla';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

import type { ImageStore } from '../../store';
import { adaptSizeToRatio, parseRatio } from '../../utils/size';
import {
  getModelAndDefaults,
  isImageModelConfigUsable,
  prepareImageModelConfigState,
} from './modelConfig';

export { getModelAndDefaults } from './modelConfig';

export interface GenerationConfigAction {
  setParamOnInput<K extends RuntimeImageGenParamsKeys>(
    paramName: K,
    value: RuntimeImageGenParamsValue,
  ): void;

  setModelAndProviderOnSelect(model: string, provider: string): void;

  setImageNum: (imageNum: number) => void;

  reuseSettings: (
    model: string,
    provider: string,
    settings: Partial<RuntimeImageGenParams>,
  ) => void;
  reuseSeed: (seed: number) => void;

  setWidth(width: number): void;
  setHeight(height: number): void;
  toggleAspectRatioLock(): void;
  setAspectRatio(aspectRatio: string): void;

  // 初始化相关方法
  _initializeDefaultImageConfig(): void;
  initializeImageConfig(
    isLogin?: boolean,
    lastSelectedImageModel?: string,
    lastSelectedImageProvider?: string,
    lastSelectedImageNum?: number,
    lastSelectedImageSize?: string | null,
  ): void;
  revalidateImageConfig(): void;
}

function getEnabledImageModel(model: string, provider: string) {
  const enabledImageModelList = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
  return enabledImageModelList
    .find((providerItem) => providerItem.id === provider)
    ?.children.find((modelItem) => modelItem.id === model) as AIImageModelCard | undefined;
}

function getUsableEnabledImageModel(model: string | undefined, provider: string | undefined) {
  if (!model || !provider || !isImageModelConfigUsable(model, provider)) return;
  return { model, provider };
}

function getFirstUsableEnabledImageModel() {
  const enabledImageModelList = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());

  for (const providerItem of enabledImageModelList) {
    for (const modelItem of providerItem.children) {
      const usableModel = getUsableEnabledImageModel(modelItem.id, providerItem.id);
      if (usableModel) return usableModel;
    }
  }
}

function isValidImageCount(imageNum: number | undefined): imageNum is number {
  return (
    Number.isInteger(imageNum) &&
    imageNum >= MIN_IMAGE_GENERATION_COUNT &&
    imageNum <= MAX_IMAGE_GENERATION_COUNT
  );
}

function isSupportedImageSize(
  parametersSchema: ModelParamsSchema,
  imageSize: string | null | undefined,
): imageSize is string {
  return !!imageSize && parametersSchema.size?.enum?.includes(imageSize);
}

function prepareInitializedImageConfig(
  model: string,
  provider: string,
  defaultImageNum: number,
  lastSelectedImageNum: number | undefined,
  lastSelectedImageSize: string | null | undefined,
  currentPrompt: string | undefined,
) {
  const { defaultValues, parametersSchema, initialActiveRatio } = prepareImageModelConfigState(
    model,
    provider,
  );
  const imageNum = isValidImageCount(lastSelectedImageNum) ? lastSelectedImageNum : defaultImageNum;
  const parameters = {
    ...defaultValues,
    ...(isSupportedImageSize(parametersSchema, lastSelectedImageSize) && {
      size: lastSelectedImageSize,
    }),
    ...(typeof currentPrompt === 'string' && { prompt: currentPrompt }),
  };

  return {
    activeAspectRatio: initialActiveRatio,
    imageNum,
    isAspectRatioLocked: false,
    model,
    parameters,
    parametersSchema,
    provider,
  };
}

function saveImagePreferences(
  model: string,
  provider: string,
  imageNum: number,
  parameters: Partial<RuntimeImageGenParams>,
  parametersSchema: ModelParamsSchema,
) {
  const isLogin = authSelectors.isLogin(useUserStore.getState());
  if (!isLogin) return;

  useGlobalStore.getState().updateSystemStatus({
    lastSelectedImageModel: model,
    lastSelectedImageProvider: provider,
    lastSelectedImageSize: isSupportedImageSize(parametersSchema, parameters.size)
      ? parameters.size
      : null,
    ...(isValidImageCount(imageNum) && { lastSelectedImageNum: imageNum }),
  });
}

export const createGenerationConfigSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationConfigAction
> = (set, get) => ({
  setParamOnInput: (paramName, value) => {
    set(
      (state) => {
        const { parameters } = state;
        return { parameters: { ...parameters, [paramName]: value } };
      },
      false,
      `setParamOnInput/${paramName}`,
    );

    if (paramName !== 'size') return;

    const { imageNum, model, parameters, parametersSchema, provider } = get();
    saveImagePreferences(model, provider, imageNum, parameters, parametersSchema);
  },

  setWidth: (width) => {
    set(
      (state) => {
        const {
          parameters,
          isAspectRatioLocked,
          activeAspectRatio,
          parametersSchema: parametersSchema,
        } = state;

        const newParams = { ...parameters, width };
        if (isAspectRatioLocked && activeAspectRatio) {
          const ratio = parseRatio(activeAspectRatio);
          const heightSchema = parametersSchema?.height;
          if (
            heightSchema &&
            typeof heightSchema.max === 'number' &&
            typeof heightSchema.min === 'number'
          ) {
            const newHeight = Math.round(width / ratio);
            newParams.height = Math.max(Math.min(newHeight, heightSchema.max), heightSchema.min);
          }
        }

        return { parameters: newParams };
      },
      false,
      `setWidth`,
    );
  },

  setHeight: (height) => {
    set(
      (state) => {
        const {
          parameters,
          isAspectRatioLocked,
          activeAspectRatio,
          parametersSchema: parametersSchema,
        } = state;
        const newParams = { ...parameters, height };

        if (isAspectRatioLocked && activeAspectRatio) {
          const ratio = parseRatio(activeAspectRatio);
          const widthSchema = parametersSchema?.width;
          if (
            widthSchema &&
            typeof widthSchema.max === 'number' &&
            typeof widthSchema.min === 'number'
          ) {
            const newWidth = Math.round(height * ratio);
            newParams.width = Math.max(Math.min(newWidth, widthSchema.max), widthSchema.min);
          }
        }

        return { parameters: newParams };
      },
      false,
      `setHeight`,
    );
  },

  toggleAspectRatioLock: () => {
    set(
      (state) => {
        const {
          isAspectRatioLocked,
          activeAspectRatio,
          parameters,
          parametersSchema: parametersSchema,
        } = state;
        const newLockState = !isAspectRatioLocked;

        // 如果是从解锁变为锁定，且有活动的宽高比，则立即调整尺寸
        if (newLockState && activeAspectRatio && parameters && parametersSchema) {
          const currentWidth = parameters.width;
          const currentHeight = parameters.height;

          // 只有当width和height都存在时才进行调整
          if (
            typeof currentWidth === 'number' &&
            typeof currentHeight === 'number' &&
            parametersSchema?.width &&
            parametersSchema?.height
          ) {
            const targetRatio = parseRatio(activeAspectRatio);
            const currentRatio = currentWidth / currentHeight;

            // 如果当前比例与目标比例不匹配，则需要调整
            if (Math.abs(currentRatio - targetRatio) > 0.01) {
              // 允许小误差
              const widthSchema = parametersSchema.width;
              const heightSchema = parametersSchema.height;

              if (
                widthSchema &&
                heightSchema &&
                typeof widthSchema.max === 'number' &&
                typeof widthSchema.min === 'number' &&
                typeof heightSchema.max === 'number' &&
                typeof heightSchema.min === 'number'
              ) {
                // 优先保持宽度，调整高度
                let newWidth = currentWidth;
                let newHeight = Math.round(currentWidth / targetRatio);

                // 如果计算出的高度超出范围，则改为保持高度，调整宽度
                if (newHeight > heightSchema.max || newHeight < heightSchema.min) {
                  newHeight = currentHeight;
                  newWidth = Math.round(currentHeight * targetRatio);

                  // 确保宽度也在范围内
                  newWidth = Math.max(Math.min(newWidth, widthSchema.max), widthSchema.min);
                } else {
                  // 确保高度在范围内
                  newHeight = Math.max(Math.min(newHeight, heightSchema.max), heightSchema.min);
                }

                return {
                  isAspectRatioLocked: newLockState,
                  parameters: { ...parameters, width: newWidth, height: newHeight },
                };
              }
            }
          }
        }

        return { isAspectRatioLocked: newLockState };
      },
      false,
      'toggleAspectRatioLock',
    );
  },

  setAspectRatio: (aspectRatio) => {
    const { parameters, parametersSchema: parametersSchema } = get();
    if (!parameters || !parametersSchema) return;

    const defaultValues = extractDefaultValues(parametersSchema);
    const newParams = { ...parameters };

    // 如果模型支持 width/height，则计算新尺寸
    if (
      parametersSchema?.width &&
      parametersSchema?.height &&
      typeof defaultValues.width === 'number' &&
      typeof defaultValues.height === 'number'
    ) {
      const ratio = parseRatio(aspectRatio);
      const { width, height } = adaptSizeToRatio(ratio, defaultValues.width, defaultValues.height);
      newParams.width = width;
      newParams.height = height;
    }

    // 如果模型本身支持 aspectRatio，则更新它
    if (parametersSchema?.aspectRatio) {
      newParams.aspectRatio = aspectRatio;
    }

    set(
      { activeAspectRatio: aspectRatio, parameters: newParams },
      false,
      `setAspectRatio/${aspectRatio}`,
    );
  },

  setModelAndProviderOnSelect: (model, provider) => {
    const { defaultValues, parametersSchema, initialActiveRatio } = prepareImageModelConfigState(
      model,
      provider,
    );
    const currentState = get();
    const isRecoveringSameModel =
      !currentState.isImageModelAvailable &&
      currentState.model === model &&
      currentState.provider === provider;
    const parameters = {
      ...defaultValues,
      ...(isRecoveringSameModel &&
        typeof currentState.parameters?.prompt === 'string' && {
          prompt: currentState.parameters.prompt,
        }),
    };

    set(
      {
        model,
        provider,
        parameters,
        parametersSchema,
        isAspectRatioLocked: false,
        activeAspectRatio: initialActiveRatio,
        isImageModelAvailable: true,
      },
      false,
      `setModelAndProviderOnSelect/${model}/${provider}`,
    );

    const { imageNum } = get();
    saveImagePreferences(model, provider, imageNum, parameters, parametersSchema);
  },

  setImageNum: (imageNum) => {
    set(() => ({ imageNum }), false, `setImageNum/${imageNum}`);

    const { model, parameters, parametersSchema, provider } = get();
    saveImagePreferences(model, provider, imageNum, parameters, parametersSchema);
  },

  reuseSettings: (model: string, provider: string, settings: Partial<RuntimeImageGenParams>) => {
    const { defaultValues, parametersSchema } = getModelAndDefaults(model, provider);
    const parameters = { ...defaultValues, ...settings };
    set(
      () => ({
        isImageModelAvailable: true,
        model,
        provider,
        parameters,
        parametersSchema: parametersSchema,
      }),
      false,
      `reuseSettings/${model}/${provider}`,
    );

    const { imageNum } = get();
    saveImagePreferences(model, provider, imageNum, parameters, parametersSchema);
  },

  reuseSeed: (seed: number) => {
    set((state) => ({ parameters: { ...state.parameters, seed } }), false, `reuseSeed/${seed}`);
  },

  _initializeDefaultImageConfig: () => {
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());
    const fallbackImageModel = getFirstUsableEnabledImageModel();
    if (!fallbackImageModel) {
      set(
        { imageNum: defaultImageNum, isImageModelAvailable: false, isInit: true },
        false,
        'initializeImageConfig/noEnabledModel',
      );
      return;
    }

    try {
      const currentPrompt = get().parameters?.prompt;
      const initialConfig = prepareInitializedImageConfig(
        fallbackImageModel.model,
        fallbackImageModel.provider,
        defaultImageNum,
        undefined,
        undefined,
        currentPrompt,
      );
      set(
        { ...initialConfig, isImageModelAvailable: true, isInit: true },
        false,
        `initializeImageConfig/default/${fallbackImageModel.model}/${fallbackImageModel.provider}`,
      );
    } catch {
      set(
        { isImageModelAvailable: false, isInit: true },
        false,
        'initializeImageConfig/noUsableEnabledModel',
      );
    }
  },

  initializeImageConfig: (
    isLogin,
    lastSelectedImageModel,
    lastSelectedImageProvider,
    lastSelectedImageNum,
    lastSelectedImageSize,
  ) => {
    const { _initializeDefaultImageConfig } = get();
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());
    const currentPrompt = get().parameters?.prompt;

    if (isLogin && lastSelectedImageModel && lastSelectedImageProvider) {
      try {
        const initialConfig = prepareInitializedImageConfig(
          lastSelectedImageModel,
          lastSelectedImageProvider,
          defaultImageNum,
          lastSelectedImageNum,
          lastSelectedImageSize,
          currentPrompt,
        );

        set(
          { ...initialConfig, isImageModelAvailable: true, isInit: true },
          false,
          `initializeImageConfig/${lastSelectedImageModel}/${lastSelectedImageProvider}`,
        );
      } catch {
        const fallbackImageModel = getFirstUsableEnabledImageModel();
        if (!fallbackImageModel) {
          _initializeDefaultImageConfig();
          return;
        }

        try {
          const initialConfig = prepareInitializedImageConfig(
            fallbackImageModel.model,
            fallbackImageModel.provider,
            defaultImageNum,
            lastSelectedImageNum,
            undefined,
            currentPrompt,
          );
          set(
            { ...initialConfig, isImageModelAvailable: true, isInit: true },
            false,
            `initializeImageConfig/fallback/${fallbackImageModel.model}/${fallbackImageModel.provider}`,
          );
          saveImagePreferences(
            fallbackImageModel.model,
            fallbackImageModel.provider,
            initialConfig.imageNum,
            initialConfig.parameters,
            initialConfig.parametersSchema,
          );
        } catch {
          set(
            { isImageModelAvailable: false, isInit: true },
            false,
            'initializeImageConfig/noUsableEnabledModel',
          );
        }
      }
    } else {
      _initializeDefaultImageConfig();
    }
  },

  revalidateImageConfig: () => {
    const {
      imageNum,
      isImageModelAvailable,
      isInit,
      model,
      parameters,
      parametersSchema,
      provider,
    } = get();
    if (!isInit) return;

    const status = useGlobalStore.getState().status;
    const rememberedImageNum = isValidImageCount(status.lastSelectedImageNum)
      ? status.lastSelectedImageNum
      : isImageModelAvailable && isValidImageCount(imageNum)
        ? imageNum
        : undefined;
    const currentEnabledModel = getEnabledImageModel(model, provider);
    const isCurrentModelSchemaCurrent =
      currentEnabledModel && isEqual(currentEnabledModel.parameters, parametersSchema);
    if (isCurrentModelSchemaCurrent && isImageModelAvailable) return;

    const rememberedImageModel = getUsableEnabledImageModel(
      status.lastSelectedImageModel,
      status.lastSelectedImageProvider,
    );
    const currentImageModel = getUsableEnabledImageModel(model, provider);
    const nextImageModel = isImageModelAvailable
      ? currentImageModel || getFirstUsableEnabledImageModel()
      : rememberedImageModel || currentImageModel || getFirstUsableEnabledImageModel();
    if (!nextImageModel) {
      set({ isImageModelAvailable: false }, false, 'revalidateImageConfig/noEnabledModel');
      return;
    }

    const isRestoringSameRememberedModel =
      status.lastSelectedImageModel === nextImageModel.model &&
      status.lastSelectedImageProvider === nextImageModel.provider;
    const currentImageSize =
      isImageModelAvailable && isRestoringSameRememberedModel ? parameters?.size : undefined;
    const rememberedImageSize = currentImageSize ?? status.lastSelectedImageSize;
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());
    try {
      const initialConfig = prepareInitializedImageConfig(
        nextImageModel.model,
        nextImageModel.provider,
        defaultImageNum,
        rememberedImageNum,
        isRestoringSameRememberedModel ? rememberedImageSize : undefined,
        parameters?.prompt,
      );
      set(
        { ...initialConfig, isImageModelAvailable: true },
        false,
        `revalidateImageConfig/${nextImageModel.model}/${nextImageModel.provider}`,
      );
      saveImagePreferences(
        nextImageModel.model,
        nextImageModel.provider,
        initialConfig.imageNum,
        initialConfig.parameters,
        initialConfig.parametersSchema,
      );
    } catch {
      set({ isImageModelAvailable: false }, false, 'revalidateImageConfig/noUsableEnabledModel');
    }
  },
});
